'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
exports.requireAuth = requireAuth
exports.signJwt = signJwt
exports.requireAdmin = requireAdmin
const jsonwebtoken_1 = __importDefault(require('jsonwebtoken'))
const User_1 = __importDefault(require('../models/User'))
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers['authorization'] || ''
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined
    const finalToken = token || req.token
    if (!finalToken) {
      return res.status(401).json({ error: 'Missing token' })
    }
    const secret = process.env.JWT_SECRET
    if (!secret) {
      return res.status(500).json({ error: 'Server misconfigured' })
    }
    const payload = jsonwebtoken_1.default.verify(finalToken, secret)
    req.userId = payload.userId
    // Enforce single-session if both token and DB carry a sessionId
    try {
      if (payload && payload.sessionId && req.userId) {
        const user = await User_1.default.findById(req.userId).lean()
        if (user && user.sessionId && user.sessionId !== payload.sessionId) {
          return res.status(401).json({ error: 'Session revoked' })
        }
      }
    } catch (_) {}
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' })
  }
}
function signJwt(userId, sessionId) {
  const secret = process.env.JWT_SECRET
  const payload = sessionId ? { userId, sessionId } : { userId }
  const token = jsonwebtoken_1.default.sign(payload, secret, {
    expiresIn: '7d',
  })
  return token
}

function requireAdmin(req, res, next) {
  // requireAuth should have set req.userId; we re-check via DB in routes
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}
