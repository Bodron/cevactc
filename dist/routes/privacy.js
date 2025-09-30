'use strict'
const { Router } = require('express')
const rateLimit = require('../middleware/rateLimit')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const DeleteRequest = require('../models/DeleteRequest')

const router = Router()
const limiter = rateLimit.sensitiveLimiter({ max: 20 })
const idem = rateLimit.idempotency()

// Create a new deletion request for current user
router.post('/delete-request', limiter, idem, requireAuth, async (req, res) => {
  try {
    const userId = req.userId
    const type = String(req.body?.type || 'delete_account')
    const notes = String(req.body?.notes || '')
    if (!['delete_account', 'delete_data'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type' })
    }
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase()
    const existing = await DeleteRequest.findOne({
      userId,
      status: { $in: ['pending', 'in_progress'] },
    })
    if (existing) {
      return res
        .status(200)
        .json({ ok: true, requestId: existing.id, status: existing.status })
    }
    const doc = await DeleteRequest.create({
      userId,
      email,
      type,
      notes,
      status: 'pending',
    })
    return res.json({ ok: true, requestId: doc.id })
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create request' })
  }
})

// List my own requests
router.get('/delete-request/me', limiter, requireAuth, async (req, res) => {
  try {
    const items = await DeleteRequest.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .lean()
    return res.json({ requests: items })
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load requests' })
  }
})

// Admin: list all requests
router.get(
  '/admin/delete-requests',
  limiter,
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    try {
      const items = await DeleteRequest.find()
        .sort({ createdAt: -1 })
        .limit(500)
        .lean()
      return res.json({ requests: items })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to load requests' })
    }
  }
)

// Admin: update status
router.post(
  '/admin/delete-requests/:id/status',
  limiter,
  idem,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const id = String(req.params.id)
      const status = String(req.body?.status || '')
      const note = String(req.body?.note || '')
      if (
        !['pending', 'in_progress', 'completed', 'rejected'].includes(status)
      ) {
        return res.status(400).json({ error: 'Invalid status' })
      }
      const update = {
        $set: {
          status,
          resolvedAt: ['completed', 'rejected'].includes(status)
            ? new Date()
            : undefined,
          resolvedBy: req.userId,
        },
        $push: { audit: { by: req.userId, action: 'status', note } },
      }
      const doc = await DeleteRequest.findByIdAndUpdate(id, update, {
        new: true,
      })
      if (!doc) return res.status(404).json({ error: 'Not found' })
      return res.json({ ok: true, request: doc })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to update request' })
    }
  }
)

module.exports = router
