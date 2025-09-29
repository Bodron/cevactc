'use strict'

// Simple in-memory rate limiters and idempotency guard
// Note: For clustered deployments, switch to a shared store (Redis) – API stays the same.

function getClientIp(req) {
  try {
    const xf = (req.headers['x-forwarded-for'] || '').toString()
    if (xf) return xf.split(',')[0].trim()
  } catch (_) {}
  try {
    return (req.ip || req.connection?.remoteAddress || 'unknown').toString()
  } catch (_) {
    return 'unknown'
  }
}

function buildKey(req, includePath = true) {
  const uid = req.userId ? `u:${req.userId}` : `ip:${getClientIp(req)}`
  const method = req.method || 'GET'
  const path = includePath ? (req.baseUrl || '') + (req.path || '') : ''
  return `${uid}|${method}|${path}`
}

function createFixedWindowLimiter({
  windowMs,
  max,
  includePath = true,
  message,
}) {
  const store = new Map()
  return function limiter(req, res, next) {
    const key = buildKey(req, includePath)
    const now = Date.now()
    const rec = store.get(key)
    if (!rec || now >= rec.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }
    if (rec.count >= max) {
      res.status(429).json({ error: message || 'Too many requests' })
      return
    }
    rec.count++
    return next()
  }
}

// Public presets
function globalLimiter(opts) {
  // Default: 90 req/min per user/IP across path+method
  return createFixedWindowLimiter({
    windowMs: opts?.windowMs ?? 60 * 1000,
    max: opts?.max ?? 90,
    includePath: true,
    message: 'Too many requests',
  })
}

function burstLimiter(opts) {
  // Default: 15 req/5s to absorb bursts
  return createFixedWindowLimiter({
    windowMs: opts?.windowMs ?? 5 * 1000,
    max: opts?.max ?? 15,
    includePath: true,
    message: 'Too many requests (burst limit)',
  })
}

function sensitiveLimiter(opts) {
  // Default: 12 req/min per user/IP per path (POST/PUT/PATCH/DELETE recommended)
  return createFixedWindowLimiter({
    windowMs: opts?.windowMs ?? 60 * 1000,
    max: opts?.max ?? 12,
    includePath: true,
    message: 'Too many requests on this endpoint',
  })
}

// Idempotency guard: if X-Idempotency-Key is reused within ttl, block duplicates
function idempotency({ ttlMs = 15 * 60 * 1000 } = {}) {
  const seen = new Map() // key -> expiresAt
  return function (req, res, next) {
    try {
      const header = (req.headers['x-idempotency-key'] || '').toString().trim()
      if (!header) return next()
      const key = `${buildKey(req, false)}|idem:${header}`
      const now = Date.now()
      const exp = seen.get(key)
      if (exp && now < exp) {
        return res.status(429).json({ error: 'Duplicate request' })
      }
      seen.set(key, now + ttlMs)
      // Periodic light cleanup (lazy)
      if (seen.size > 5000) {
        for (const [k, v] of seen.entries()) {
          if (v <= now) seen.delete(k)
        }
      }
      return next()
    } catch (_) {
      return next()
    }
  }
}

module.exports = {
  globalLimiter,
  burstLimiter,
  sensitiveLimiter,
  idempotency,
}
