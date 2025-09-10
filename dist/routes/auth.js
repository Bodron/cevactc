'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
const express_1 = require('express')
const bcryptjs_1 = __importDefault(require('bcryptjs'))
const User_1 = __importDefault(require('../models/User'))
const auth_1 = require('../middleware/auth')
const uuid_1 = require('uuid')
const auth_2 = require('../middleware/auth')
const nodemailer_1 = __importDefault(require('nodemailer'))
const https_1 = require('https')
const router = (0, express_1.Router)()
function normalizeEmail(raw) {
  try {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
  } catch (_) {
    return ''
  }
}
function isValidEmail(email) {
  // RFC 5322–ish simple validator
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
  return re.test(email)
}

router.post('/register', async (req, res) => {
  try {
    const {
      email,
      password,
      displayName,
      acceptedTerms,
      acceptedAt,
      ageDeclaration,
    } = req.body
    const emailNorm = normalizeEmail(email)
    if (!emailNorm || !password || !displayName) {
      return res.status(400).json({ error: 'Missing fields' })
    }
    if (!isValidEmail(emailNorm)) {
      return res.status(400).json({ error: 'Invalid email' })
    }
    if (!acceptedTerms || !ageDeclaration) {
      return res
        .status(400)
        .json({ error: 'Terms and age confirmation required' })
    }
    const existing = await User_1.default.findOne({ email: emailNorm })
    if (existing) {
      return res.status(409).json({ error: 'Email already in use' })
    }
    const hash = await bcryptjs_1.default.hash(password, 10)
    const sessionId = (0, uuid_1.v4)()
    const user = await User_1.default.create({
      email: emailNorm,
      passwordHash: hash,
      displayName,
      sessionId,
      acceptedTerms: !!acceptedTerms,
      acceptedAt: acceptedAt ? new Date(acceptedAt) : new Date(),
      ageDeclaration: !!ageDeclaration,
    })
    const token = (0, auth_1.signJwt)(user.id, sessionId)
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role || 'User',
        eloPoints: user.eloPoints,
        divisionTier: user.divisionTier,
        divisionRank: user.divisionRank,
        avatarAsset: user.avatarAsset || null,
      },
    })
  } catch (err) {
    return res.status(500).json({ error: 'Failed to register' })
  }
})
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    const emailNorm = normalizeEmail(email)
    if (!isValidEmail(emailNorm)) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    const user = await User_1.default.findOne({ email: emailNorm })
    if (!user) return res.status(401).json({ error: 'Invalid credentials' })
    const ok = await bcryptjs_1.default.compare(password, user.passwordHash)
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' })
    // Rotate sessionId to revoke previous sessions
    user.sessionId = (0, uuid_1.v4)()
    await user.save()
    const token = (0, auth_1.signJwt)(user.id, user.sessionId)
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role || 'User',
        eloPoints: user.eloPoints,
        divisionTier: user.divisionTier,
        divisionRank: user.divisionRank,
        avatarAsset: user.avatarAsset || null,
      },
    })
  } catch (err) {
    return res.status(500).json({ error: 'Failed to login' })
  }
})
router.get('/me', auth_2.requireAuth, async (req, res) => {
  try {
    const userId = req.userId
    const user = await User_1.default.findById(userId)
    if (!user) return res.status(404).json({ error: 'Not found' })
    return res.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      eloPoints: user.eloPoints,
      divisionTier: user.divisionTier,
      divisionRank: user.divisionRank,
      avatarAsset: user.avatarAsset || null,
    })
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load profile' })
  }
})

// Ranked stats for current user
router.get('/me/stats', auth_2.requireAuth, async (req, res) => {
  try {
    const userId = req.userId
    const user = await User_1.default.findById(userId)
    if (!user) return res.status(404).json({ error: 'Not found' })
    return res.json({
      matches: user.matches || 0,
      wins: user.wins || 0,
      losses: user.losses || 0,
    })
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load stats' })
  }
})

// Update avatar asset path for current user
router.patch('/avatar', auth_2.requireAuth, async (req, res) => {
  try {
    const userId = req.userId
    const avatarAsset = (req.body?.avatarAsset || '').toString()
    if (!avatarAsset) {
      return res.status(400).json({ error: 'Missing avatarAsset' })
    }
    const user = await User_1.default.findByIdAndUpdate(
      userId,
      { avatarAsset },
      { new: true }
    )
    if (!user) return res.status(404).json({ error: 'Not found' })
    return res.json({ ok: true, avatarAsset: user.avatarAsset || null })
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update avatar' })
  }
})
exports.default = router
// Forgot password: generate a temporary password and email it
router.post('/forgot', async (req, res) => {
  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase()
  if (!email) return res.status(400).json({ error: 'Missing email' })
  try {
    const user = await User_1.default.findOne({ email })
    if (!user) return res.json({ ok: true })
    // Issue reset token (random) valid 30 minutes
    const token =
      Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
    user.resetToken = token
    user.resetExpires = new Date(Date.now() + 30 * 60 * 1000)
    await user.save()

    const port = Number(process.env.SMTP_PORT || 587)
    const transporter = nodemailer_1.default.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // use SSL for 465, STARTTLS for 587
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    })
    const fromEnv =
      process.env.MAIL_FROM || 'no-reply@crackthecodemultiplayer.com'
    const from = fromEnv
      .replace(/.*<([^>]+)>.*/, '$1')
      .replace(/^['"]|['"]$/g, '')
      .trim()
    const appLink =
      (process.env.APP_RESET_LINK_BASE || 'crackthecode://reset') +
      `?token=${encodeURIComponent(token)}`
    const webLink =
      (process.env.WEB_RESET_LINK_BASE ||
        'https://crackthecodemultiplayer.com/reset') +
      `?token=${encodeURIComponent(token)}`
    await transporter.sendMail({
      from,
      to: email,
      subject: 'Reset your password',
      text: `Tap to reset your password: ${appLink}\nIf that doesn't work, use: ${webLink}\nThis link expires in 30 minutes.`,
    })
    return res.json({ ok: true })
  } catch (e) {
    const msg = e && e.message ? e.message : 'Failed to send reset email'
    return res.status(500).json({ error: msg })
  }
})
// Change password with old + new
router.post('/change-password', auth_2.requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {}
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Missing fields' })
    }
    const user = await User_1.default.findById(req.userId)
    if (!user) return res.status(404).json({ error: 'Not found' })
    const ok = await bcryptjs_1.default.compare(
      String(oldPassword),
      user.passwordHash
    )
    if (!ok) return res.status(401).json({ error: 'Invalid password' })
    user.passwordHash = await bcryptjs_1.default.hash(String(newPassword), 10)
    await user.save()
    return res.json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: 'Failed to change password' })
  }
})

// Change password using temporary password, without login
router.post('/change-password-temp', async (req, res) => {
  try {
    const { token, newPassword } = req.body || {}
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Missing fields' })
    }
    const user = await User_1.default.findOne({ resetToken: token })
    if (
      !user ||
      !user.resetExpires ||
      user.resetExpires.getTime() < Date.now()
    ) {
      return res.status(400).json({ error: 'Invalid or expired token' })
    }
    user.passwordHash = await bcryptjs_1.default.hash(String(newPassword), 10)
    user.resetToken = null
    user.resetExpires = null
    await user.save()
    return res.json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: 'Failed to change password' })
  }
})
