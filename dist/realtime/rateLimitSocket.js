'use strict'

// Very small per-socket rate limiter (fixed window)
// Use separate instances per event type to keep limits clear.

function createLimiter({ windowMs, max }) {
  const buckets = new Map() // key -> {count, resetAt}
  return function allow(socket, key) {
    try {
      const k = `${socket.id}|${key}`
      const now = Date.now()
      const rec = buckets.get(k)
      if (!rec || now >= rec.resetAt) {
        buckets.set(k, { count: 1, resetAt: now + windowMs })
        return true
      }
      if (rec.count >= max) return false
      rec.count++
      return true
    } catch (_) {
      return true
    }
  }
}

module.exports = { createLimiter }
