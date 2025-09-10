'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
const mongoose_1 = __importDefault(require('mongoose'))

// Track per-user daily play counts (all modes). Keep for 60 days by default.
const DailyPlaySchema = new mongoose_1.default.Schema(
  {
    userId: { type: String, default: null, index: true },
    deviceId: { type: String, default: null, index: true },
    day: { type: String, required: true, index: true }, // YYYY-MM-DD
    ranked: { type: Number, default: 0 },
    casual: { type: Number, default: 0 },
    withFriends: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now, expires: 60 * 24 * 60 * 60 },
  },
  { timestamps: false }
)
// Enforce one doc per (deviceId, day) when deviceId is present
try {
  DailyPlaySchema.index(
    { deviceId: 1, day: 1 },
    { unique: true, partialFilterExpression: { deviceId: { $type: 'string' } } }
  )
  // Fallback uniqueness per (userId, day) when deviceId is null
  DailyPlaySchema.index(
    { userId: 1, day: 1 },
    { unique: true, partialFilterExpression: { deviceId: { $eq: null } } }
  )
} catch (_) {}

const DailyPlay = mongoose_1.default.model('DailyPlay', DailyPlaySchema)
exports.default = DailyPlay
