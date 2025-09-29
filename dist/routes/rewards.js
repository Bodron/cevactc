'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
const express = require('express')
const crypto = require('crypto')
const Reward = require('../models/Reward').default
const RewardAuditLog = require('../models/RewardAuditLog').default
const GiftCard = require('../models/GiftCard').default
const Season = require('../models/Season').default
const User = require('../models/User').default
const nodemailer = require('nodemailer')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const router = express.Router()
const rateLimit = require('../middleware/rateLimit')
const strictLimiter = rateLimit.sensitiveLimiter({ max: 10 })
const idem = rateLimit.idempotency()

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

// Get eligibility and status for the logged-in user for last ended season
router.get('/me/eligibility', strictLimiter, requireAuth, async (req, res) => {
  try {
    const now = new Date()
    const lastSeason = await Season.findOne({ endAt: { $lt: now } })
      .sort({ endAt: -1 })
      .lean()
    if (!lastSeason) return res.json({ eligible: false, season: null })
    const reward = await Reward.findOne({
      seasonName: lastSeason.name,
      userId: req.userId,
    }).lean()
    return res.json({
      eligible: !!reward,
      status: reward?.status || 'none',
      season: { name: lastSeason.name, endAt: lastSeason.endAt },
    })
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load eligibility' })
  }
})

// Issue a short-lived claim token for the logged-in winner
router.post(
  '/me/issue-claim-token',
  strictLimiter,
  requireAuth,
  idem,
  async (req, res) => {
    try {
      const { seasonName } = req.body || {}
      if (!seasonName)
        return res.status(400).json({ error: 'Missing seasonName' })
      const reward = await Reward.findOne({ seasonName, userId: req.userId })
      if (!reward) return res.status(404).json({ error: 'Not eligible' })
      if (reward.status !== 'pending') {
        return res.status(400).json({ error: 'Already claimed or expired' })
      }
      const raw = crypto.randomBytes(24).toString('base64url')
      reward.claimTokenHash = hashToken(raw)
      reward.claimTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 min
      await reward.save()
      await RewardAuditLog.create({
        rewardId: reward._id,
        event: 'TOKEN_CREATED',
        actorUserId: req.userId,
      })
      return res.json({ token: raw })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to issue token' })
    }
  }
)

// Claim for the logged-in winner without token (simple flow)
router.post(
  '/me/claim-now',
  strictLimiter,
  requireAuth,
  idem,
  async (req, res) => {
    try {
      const seasonName = String(req.body?.seasonName || '').trim()
      let reward = null
      if (seasonName) {
        reward = await Reward.findOne({ seasonName, userId: req.userId })
      } else {
        const now = new Date()
        const lastSeason = await Season.findOne({ endAt: { $lt: now } })
          .sort({ endAt: -1 })
          .lean()
        if (lastSeason) {
          reward = await Reward.findOne({
            seasonName: lastSeason.name,
            userId: req.userId,
          })
        }
      }
      if (!reward) return res.status(404).json({ error: 'Not eligible' })
      if (reward.status !== 'pending') {
        return res.status(400).json({ error: 'Already claimed or expired' })
      }

      reward.status = 'claimed'
      reward.isClaimed = true
      reward.claimedAt = new Date()
      reward.claimedIp =
        req.headers['x-forwarded-for']?.toString().split(',')[0] ||
        req.socket.remoteAddress ||
        ''
      reward.claimedUserAgent = req.headers['user-agent'] || ''
      reward.claimTokenHash = null
      reward.claimTokenExpiresAt = null
      await reward.save()

      await RewardAuditLog.create({
        rewardId: reward._id,
        event: 'CLAIM_CONFIRMED',
        actorUserId: req.userId,
        ip: reward.claimedIp,
        userAgent: reward.claimedUserAgent,
      })

      return res.json({
        ok: true,
        claimedAt: reward.claimedAt,
        isClaimed: reward.isClaimed,
      })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to claim' })
    }
  }
)

// Claim reward using token (site) – requires login and token
router.post('/claim', strictLimiter, requireAuth, idem, async (req, res) => {
  try {
    const { token, seasonName } = req.body || {}
    if (!token || !seasonName) {
      return res.status(400).json({ error: 'Missing fields' })
    }
    const reward = await Reward.findOne({ seasonName, userId: req.userId })
    if (!reward) return res.status(404).json({ error: 'Not found' })
    if (reward.status !== 'pending') {
      return res.status(400).json({ error: 'Already claimed or expired' })
    }
    if (!reward.claimTokenHash || !reward.claimTokenExpiresAt) {
      return res.status(400).json({ error: 'Token required' })
    }
    if (reward.claimTokenExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'Token expired' })
    }
    const good = reward.claimTokenHash === hashToken(token)
    if (!good) return res.status(400).json({ error: 'Invalid token' })

    // Assign first available gift card (value >= 25)
    const gift = await GiftCard.findOne({ assignedToRewardId: null }).sort({
      createdAt: 1,
    })
    if (!gift)
      return res.status(503).json({ error: 'No gift cards available yet' })

    // Idempotent transaction by checking status
    reward.status = 'claimed'
    reward.isClaimed = true
    reward.claimedAt = new Date()
    reward.claimedIp =
      req.headers['x-forwarded-for']?.toString().split(',')[0] ||
      req.socket.remoteAddress ||
      ''
    reward.claimedUserAgent = req.headers['user-agent'] || ''
    reward.claimTokenHash = null
    reward.claimTokenExpiresAt = null
    await reward.save()

    gift.assignedToRewardId = reward._id
    gift.assignedAt = new Date()
    await gift.save()

    await RewardAuditLog.create({
      rewardId: reward._id,
      event: 'CLAIM_CONFIRMED',
      actorUserId: req.userId,
      ip: reward.claimedIp,
      userAgent: reward.claimedUserAgent,
      metadata: { giftCardId: gift._id, codeLast4: gift.codeLast4 },
    })

    // NOTE: email sending is handled by a separate worker/cron; here we only mark claimed
    return res.json({
      ok: true,
      claimedAt: reward.claimedAt,
      isClaimed: reward.isClaimed,
      codeLast4: gift.codeLast4,
    })
  } catch (e) {
    return res.status(500).json({ error: 'Failed to claim' })
  }
})

// Admin: import gift cards (expects already-encrypted code)
router.post(
  '/admin/gift-cards/import',
  strictLimiter,
  requireAuth,
  requireAdmin,
  idem,
  async (req, res) => {
    try {
      const user = await User.findById(req.userId)
      if (!user || (user.role || 'User') !== 'Admin')
        return res.status(403).json({ error: 'Forbidden' })
      const items = Array.isArray(req.body?.items) ? req.body.items : []
      if (!items.length) return res.status(400).json({ error: 'No items' })
      const docs = await GiftCard.insertMany(
        items.map((i) => ({
          provider: String(i.provider || 'Generic'),
          currency: String(i.currency || 'USD'),
          value: Number(i.value || 25),
          codeEncrypted: String(i.codeEncrypted),
          codeLast4: String(i.codeLast4 || '').slice(-4),
        })),
        { ordered: false }
      )
      return res.json({ ok: true, inserted: docs.length })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to import gift cards' })
    }
  }
)

// --- Admin endpoints ---
router.get(
  '/admin/season/:seasonName',
  strictLimiter,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const seasonName = req.params.seasonName
      let rewards = await Reward.find({ seasonName }).sort({ rank: 1 }).lean()

      // Auto-generate rewards if none exist but season is finalized
      if (!rewards.length) {
        const seasonDoc = await Season.findOne({ name: seasonName }).lean()
        if (seasonDoc && seasonDoc.snapshotDone) {
          const topN = Math.max(
            1,
            Math.min(100, Number(seasonDoc.numberOfWinners || 1))
          )
          const SeasonResult = require('../models/SeasonResult').default
          const results = await SeasonResult.find({ seasonName })
            .sort({ finalRank: 1 })
            .limit(topN)
            .lean()
          let rank = 1
          for (const r of results) {
            await Reward.updateOne(
              { seasonName, userId: r.userId },
              { $setOnInsert: { rank, status: 'pending' } },
              { upsert: true }
            )
            rank++
          }
          rewards = await Reward.find({ seasonName }).sort({ rank: 1 }).lean()
        }
      }
      const userIds = rewards.map((r) => r.userId).filter(Boolean)
      const users = await User.find(
        { _id: { $in: userIds } },
        { email: 1, displayName: 1 }
      ).lean()
      const userMap = new Map(users.map((u) => [String(u._id), u]))
      // gift card last4
      const rewardIds = rewards.map((r) => r._id)
      const gifts = await GiftCard.find({
        assignedToRewardId: { $in: rewardIds },
      }).lean()
      const giftMap = new Map(
        gifts.map((g) => [String(g.assignedToRewardId), g])
      )
      // If still empty, derive on the fly from SeasonResult so UI can display winners immediately
      if (!rewards.length) {
        const seasonDoc = await Season.findOne({ name: seasonName }).lean()
        const topN = Math.max(
          1,
          Math.min(100, Number(seasonDoc?.numberOfWinners || 1))
        )
        const SeasonResult = require('../models/SeasonResult').default
        const derived = await SeasonResult.find({ seasonName })
          .sort({ finalRank: 1 })
          .limit(topN)
          .lean()
        // Shape like rewards, but without DB reward id
        const userIds2 = derived.map((d) => d.userId)
        const users2 = await User.find(
          { _id: { $in: userIds2 } },
          { email: 1, displayName: 1 }
        ).lean()
        const userMap2 = new Map(users2.map((u) => [String(u._id), u]))
        const outDerived = derived.map((d, idx) => ({
          _id: `derived-${idx + 1}`,
          seasonName,
          userId: d.userId,
          rank: d.finalRank || idx + 1,
          status: 'pending',
          user: userMap2.get(String(d.userId)) || null,
          gift: null,
        }))
        return res.json({ rewards: outDerived })
      }

      // Add visual expiry info: 15 days after season end
      const seasonDoc = await Season.findOne({ name: seasonName }).lean()
      const expireAt = seasonDoc?.endAt
        ? new Date(
            new Date(seasonDoc.endAt).getTime() + 15 * 24 * 60 * 60 * 1000
          )
        : null
      const out = rewards.map((r) => ({
        ...r,
        user: userMap.get(String(r.userId)) || null,
        gift: giftMap.get(String(r._id))
          ? {
              provider: giftMap.get(String(r._id)).provider,
              value: giftMap.get(String(r._id)).value,
              codeLast4: giftMap.get(String(r._id)).codeLast4,
              sentAt: giftMap.get(String(r._id)).sentAt || null,
            }
          : null,
        claimExpiresAt: expireAt,
      }))
      return res.json({ rewards: out })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to load season rewards' })
    }
  }
)

router.get(
  '/admin/gift-cards',
  strictLimiter,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const assigned = req.query.assigned
      const q =
        typeof assigned === 'string'
          ? assigned === 'true'
            ? { assignedToRewardId: { $ne: null } }
            : { assignedToRewardId: null }
          : {}
      const cards = await GiftCard.find(q).sort({ createdAt: 1 }).lean()
      return res.json({ giftCards: cards })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to load gift cards' })
    }
  }
)

router.post(
  '/admin/gift-cards/import-plain',
  strictLimiter,
  requireAuth,
  requireAdmin,
  idem,
  async (req, res) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : []
      if (!items.length) return res.status(400).json({ error: 'No items' })
      const docs = await GiftCard.insertMany(
        items.map((i) => ({
          provider: String(i.provider || 'Generic'),
          currency: String(i.currency || 'USD'),
          value: Number(i.value || 25),
          codeEncrypted: String(i.code || i.codeEncrypted || ''),
          codeLast4: String(i.code || i.codeEncrypted || '').slice(-4),
        })),
        { ordered: false }
      )
      return res.json({ ok: true, inserted: docs.length })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to import gift cards' })
    }
  }
)

router.get(
  '/admin/reward/:id/audit',
  strictLimiter,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const logs = await RewardAuditLog.find({ rewardId: req.params.id })
        .sort({ createdAt: 1 })
        .lean()
      return res.json({ audit: logs })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to load audit' })
    }
  }
)

router.post(
  '/admin/reward/:id/assign-first',
  strictLimiter,
  requireAuth,
  requireAdmin,
  idem,
  async (req, res) => {
    try {
      const reward = await Reward.findById(req.params.id)
      if (!reward) return res.status(404).json({ error: 'Reward not found' })
      // Prevent assigning before expiry window
      const season = await Season.findOne({ name: reward.seasonName }).lean()
      if (season?.endAt) {
        const cutoff = new Date(
          new Date(season.endAt).getTime() + 15 * 24 * 60 * 60 * 1000
        )
        if (Date.now() < cutoff.getTime()) {
          return res
            .status(409)
            .json({ error: 'Claim window active – try after 15 days' })
        }
      }
      const gift = await GiftCard.findOne({ assignedToRewardId: null }).sort({
        createdAt: 1,
      })
      if (!gift)
        return res.status(409).json({ error: 'No unassigned gift cards' })
      gift.assignedToRewardId = reward._id
      gift.assignedAt = new Date()
      await gift.save()
      await RewardAuditLog.create({
        rewardId: reward._id,
        event: 'ADMIN_ASSIGN',
        actorUserId: req.userId,
        ip:
          req.headers['x-forwarded-for']?.toString().split(',')[0] ||
          req.socket.remoteAddress ||
          '',
        userAgent: req.headers['user-agent'] || '',
        metadata: {
          giftCardId: gift._id,
          provider: gift.provider,
          value: gift.value,
          codeLast4: gift.codeLast4,
          seasonName: reward.seasonName,
        },
      })
      return res.json({
        ok: true,
        giftCardId: gift._id,
        codeLast4: gift.codeLast4,
      })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to assign gift card' })
    }
  }
)

// Admin: reassign reward to next eligible player after 15 days window
router.post(
  '/admin/reward/:id/reassign-next',
  strictLimiter,
  requireAuth,
  requireAdmin,
  idem,
  async (req, res) => {
    try {
      const reward = await Reward.findById(req.params.id)
      if (!reward) return res.status(404).json({ error: 'Reward not found' })
      const season = await Season.findOne({ name: reward.seasonName }).lean()
      if (!season) return res.status(404).json({ error: 'Season not found' })
      const cutoff = new Date(
        new Date(season.endAt).getTime() + 15 * 24 * 60 * 60 * 1000
      )
      if (Date.now() < cutoff.getTime()) {
        return res
          .status(409)
          .json({ error: 'Claim window active – try after 15 days' })
      }
      // Find next unclaimed reward (higher rank number)
      const next = await Reward.findOne({
        seasonName: reward.seasonName,
        status: 'pending',
        rank: { $gt: reward.rank },
      })
        .sort({ rank: 1 })
        .lean()
      if (!next)
        return res.status(404).json({ error: 'No next pending reward' })
      // Swap ownership: move this reward to "expired" and promote next as winner (rank remains)
      await Reward.updateOne(
        { _id: reward._id },
        { $set: { status: 'expired' } }
      )
      // Assign first free gift card to next (optional now or via separate call)
      const user = await User.findById(next.userId).lean()
      return res.json({
        ok: true,
        reassignedToRewardId: next._id,
        nextUser: {
          id: next.userId,
          displayName: user?.displayName || null,
          email: user?.email || null,
        },
        nextRank: next.rank,
      })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to reassign reward' })
    }
  }
)

router.post(
  '/admin/reward/:id/reissue-token',
  strictLimiter,
  requireAuth,
  requireAdmin,
  idem,
  async (req, res) => {
    try {
      const reward = await Reward.findById(req.params.id)
      if (!reward) return res.status(404).json({ error: 'Reward not found' })
      if (reward.status !== 'pending')
        return res.status(400).json({ error: 'Not pending' })
      const raw = crypto.randomBytes(24).toString('base64url')
      reward.claimTokenHash = hashToken(raw)
      reward.claimTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000)
      await reward.save()
      await RewardAuditLog.create({
        rewardId: reward._id,
        event: 'ADMIN_TOKEN_REISSUED',
      })
      return res.json({ token: raw })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to reissue token' })
    }
  }
)

router.post(
  '/admin/reward/:id/mark-sent',
  strictLimiter,
  requireAuth,
  requireAdmin,
  idem,
  async (req, res) => {
    try {
      const reward = await Reward.findById(req.params.id)
      if (!reward) return res.status(404).json({ error: 'Reward not found' })
      const gift = await GiftCard.findOne({ assignedToRewardId: reward._id })
      if (!gift) return res.status(404).json({ error: 'No assigned gift card' })
      gift.sentAt = new Date()
      await gift.save()
      reward.emailSentAt = new Date()
      await reward.save()
      await RewardAuditLog.create({
        rewardId: reward._id,
        event: 'ADMIN_MARK_SENT',
        actorUserId: req.userId,
        ip:
          req.headers['x-forwarded-for']?.toString().split(',')[0] ||
          req.socket.remoteAddress ||
          '',
        userAgent: req.headers['user-agent'] || '',
        metadata: {
          giftCardId: gift._id,
          provider: gift.provider,
          value: gift.value,
          codeLast4: gift.codeLast4,
          seasonName: reward.seasonName,
        },
      })
      return res.json({ ok: true, sentAt: gift.sentAt })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to mark sent' })
    }
  }
)

// Admin: list rewards across all seasons (for dashboard global view)
router.get(
  '/admin/rewards',
  strictLimiter,
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    try {
      let rewards = await Reward.find({})
        .sort({ seasonName: 1, rank: 1 })
        .lean()

      const userIds = rewards.map((r) => r.userId).filter(Boolean)
      const users = await User.find(
        { _id: { $in: userIds } },
        { email: 1, displayName: 1 }
      ).lean()
      const userMap = new Map(users.map((u) => [String(u._id), u]))

      const rewardIds = rewards.map((r) => r._id)
      const gifts = await GiftCard.find({
        assignedToRewardId: { $in: rewardIds },
      }).lean()
      const giftMap = new Map(
        gifts.map((g) => [String(g.assignedToRewardId), g])
      )

      const out = rewards.map((r) => ({
        ...r,
        user: userMap.get(String(r.userId)) || null,
        gift: giftMap.get(String(r._id))
          ? {
              provider: giftMap.get(String(r._id)).provider,
              value: giftMap.get(String(r._id)).value,
              codeLast4: giftMap.get(String(r._id)).codeLast4,
              sentAt: giftMap.get(String(r._id)).sentAt || null,
            }
          : null,
      }))
      return res.json({ rewards: out })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to load rewards' })
    }
  }
)

// Admin: send gift email now (reads assigned gift and emails user)
router.post(
  '/admin/reward/:id/send-email',
  strictLimiter,
  requireAuth,
  requireAdmin,
  idem,
  async (req, res) => {
    try {
      const reward = await Reward.findById(req.params.id)
      if (!reward) return res.status(404).json({ error: 'Reward not found' })
      const user = await User.findById(reward.userId)
      if (!user) return res.status(404).json({ error: 'User not found' })
      const gift = await GiftCard.findOne({ assignedToRewardId: reward._id })
      if (!gift) return res.status(404).json({ error: 'No assigned gift card' })

      const fromEnv =
        process.env.MAIL_FROM || 'no-reply@crackthecodemultiplayer.com'
      const from = fromEnv
        .replace(/.*<([^>]+)>.*/, '$1')
        .replace(/^['"]|['"]$/g, '')
        .trim()

      const bodyText =
        `Congrats! Here is your ${gift.provider} gift card (value $${gift.value}).\n` +
        `Code: ${gift.codeEncrypted}\n\n` +
        `If you have issues, reply to this email.`
      const bodyHtml = `
        <p>Congrats! Here is your <strong>${gift.provider}</strong> gift card (value $${gift.value}).</p>
        <p><strong>Code:</strong> <code>${gift.codeEncrypted}</code></p>
        <p>If you have issues, reply to this email.</p>
      `

      const info = await sendWithRetry({
        from,
        to: user.email,
        subject: `Your reward for ${reward.seasonName}`,
        text: bodyText,
        html: bodyHtml,
      })

      gift.sentAt = new Date()
      await gift.save()
      reward.emailSentAt = new Date()
      await reward.save()
      await RewardAuditLog.create({
        rewardId: reward._id,
        event: 'ADMIN_EMAIL_SENT',
        actorUserId: req.userId,
        ip:
          req.headers['x-forwarded-for']?.toString().split(',')[0] ||
          req.socket.remoteAddress ||
          '',
        userAgent: req.headers['user-agent'] || '',
        metadata: {
          messageId: info?.messageId || null,
          giftCardId: gift._id,
          provider: gift.provider,
          value: gift.value,
          codeLast4: gift.codeLast4,
          to: user.email,
          seasonName: reward.seasonName,
        },
      })
      return res.json({ ok: true, messageId: info?.messageId || null })
    } catch (e) {
      const msg = e && e.message ? e.message : 'Failed to send gift email'
      try {
        console.error('[rewards/send-email] %s', msg, e)
      } catch {}
      return res.status(500).json({ error: msg })
    }
  }
)

// export router (ensure it's after all route registrations)
exports.default = router

// --- Mailer for reward emails (reuse config similar to auth router) ---
const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com'
const smtpPort = Number(process.env.SMTP_PORT || 587)
const mailTransporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465,
  requireTLS: smtpPort === 587,
  pool: true,
  maxConnections: 2,
  maxMessages: 50,
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 20000,
  name: 'mail.crackthecodemultiplayer.com',
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined,
  tls: { servername: smtpHost, minVersion: 'TLSv1.2' },
})

async function sendWithRetry(mailOptions, attempts = 5) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await mailTransporter.sendMail(mailOptions)
    } catch (e) {
      const msg = String(e?.message || '')
      const code = e?.responseCode
      const isTemp =
        code === 421 ||
        code === 450 ||
        code === 451 ||
        code === 452 ||
        /\b421\b|4\.7\.0|ETIMEDOUT|ECONNECTION|EAI_AGAIN/i.test(msg)
      if (isTemp && i < attempts - 1) {
        const wait = Math.min(30000, 2000 * (i + 1))
        await new Promise((r) => setTimeout(r, wait))
        continue
      }
      lastErr = e
      break
    }
  }
  throw lastErr
}
