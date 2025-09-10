'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
const express_1 = require('express')
const Season_1 = __importDefault(require('../models/Season'))
const SeasonResult_1 = __importDefault(require('../models/SeasonResult'))
const User_1 = __importDefault(require('../models/User'))
const router = (0, express_1.Router)()
const auth_1 = require('../middleware/auth')

// Public: get active season and pause status
router.get('/current', async (_req, res) => {
  try {
    const now = new Date()
    const season = await Season_1.default
      .findOne({
        startAt: { $lte: now },
        endAt: { $gte: now },
      })
      .sort({ startAt: -1 })
      .lean()
    const pause = await Season_1.default
      .findOne({
        endAt: { $lt: now },
        payoutUntil: { $gte: now },
      })
      .sort({ endAt: -1 })
      .lean()
    return res.json({ season, paused: !!pause })
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load season' })
  }
})

// Admin endpoints (protect behind reverse proxy / admin project)
router.post('/', auth_1.requireAuth, auth_1.requireAdmin, async (req, res) => {
  try {
    const user = await User_1.default.findById(req.userId)
    if (!user || (user.role || 'User') !== 'Admin')
      return res.status(403).json({ error: 'Forbidden' })
    const { name, startAt, endAt, payoutUntil } = req.body || {}
    if (!name || !startAt || !endAt)
      return res.status(400).json({ error: 'Missing fields' })
    const s = await Season_1.default.create({
      name,
      startAt: new Date(startAt),
      endAt: new Date(endAt),
      payoutUntil: payoutUntil ? new Date(payoutUntil) : null,
    })
    return res.json(s)
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create season' })
  }
})

router.post(
  '/finalize',
  auth_1.requireAuth,
  auth_1.requireAdmin,
  async (req, res) => {
    try {
      const user = await User_1.default.findById(req.userId)
      if (!user || (user.role || 'User') !== 'Admin')
        return res.status(403).json({ error: 'Forbidden' })
      const { seasonName } = req.body || {}
      if (!seasonName)
        return res.status(400).json({ error: 'Missing seasonName' })
      // compute final ranks and store SeasonResult
      const users = await User_1.default
        .find(
          {},
          {
            _id: 1,
            eloPoints: 1,
          }
        )
        .sort({ eloPoints: -1, updatedAt: 1 })
        .lean()
      let rank = 1
      for (const u of users) {
        await SeasonResult_1.default.updateOne(
          { seasonName, userId: u._id },
          { $set: { finalRank: rank, eloPoints: u.eloPoints } },
          { upsert: true }
        )
        rank++
      }
      return res.json({ ok: true, results: users.length })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to finalize season' })
    }
  }
)

router.post(
  '/reset',
  auth_1.requireAuth,
  auth_1.requireAdmin,
  async (req, res) => {
    try {
      const user = await User_1.default.findById(req.userId)
      if (!user || (user.role || 'User') !== 'Admin')
        return res.status(403).json({ error: 'Forbidden' })
      // reset ranked data for all users
      await User_1.default.updateMany(
        {},
        {
          $set: {
            eloPoints: 0,
            divisionTier: 'Bronze',
            divisionRank: 'IV',
            matches: 0,
            wins: 0,
            losses: 0,
          },
        }
      )
      return res.json({ ok: true })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to reset users' })
    }
  }
)

router.get('/results/:seasonName', async (req, res) => {
  try {
    const seasonName = req.params.seasonName
    const results = await SeasonResult_1.default
      .find({ seasonName })
      .sort({ finalRank: 1 })
      .lean()
    return res.json({ results })
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load results' })
  }
})

// Get last completed season result for current user
router.get('/me/last', auth_1.requireAuth, async (req, res) => {
  try {
    const now = new Date()
    const lastSeason = await Season_1.default
      .findOne({ endAt: { $lt: now } })
      .sort({ endAt: -1 })
      .lean()
    if (!lastSeason) return res.json({ season: null, result: null })
    const result = await SeasonResult_1.default
      .findOne({ seasonName: lastSeason.name, userId: req.userId })
      .lean()
    return res.json({
      season: { name: lastSeason.name, endAt: lastSeason.endAt },
      result,
    })
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load last season result' })
  }
})

exports.default = router
