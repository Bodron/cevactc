'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
const express_1 = require('express')
const Notification_1 = __importDefault(require('../models/Notification'))
const auth_1 = require('../middleware/auth')
const User_1 = __importDefault(require('../models/User'))
const router = (0, express_1.Router)()

router.get('/', async (_req, res) => {
  try {
    const now = new Date()
    const list = await Notification_1.default
      .find({
        $or: [{ expiresAt: null }, { expiresAt: { $gte: now } }],
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
    return res.json({ notifications: list })
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load notifications' })
  }
})

router.post('/', auth_1.requireAuth, auth_1.requireAdmin, async (req, res) => {
  try {
    const user = await User_1.default.findById(req.userId)
    if (!user || (user.role || 'User') !== 'Admin')
      return res.status(403).json({ error: 'Forbidden' })
    const { title, body, expiresAt } = req.body || {}
    if (!title || !body)
      return res.status(400).json({ error: 'Missing fields' })
    const n = await Notification_1.default.create({
      title,
      body,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    })
    return res.json(n)
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create notification' })
  }
})

exports.default = router
