'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
const mongoose = require('mongoose')

const RewardAuditLogSchema = new mongoose.Schema(
  {
    rewardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Reward',
      required: true,
      index: true,
    },
    event: { type: String, required: true },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    metadata: { type: Object, default: {} },
    chainPrevHash: { type: String, default: null },
    chainHash: { type: String, default: null },
  },
  { timestamps: true }
)

const RewardAuditLog = mongoose.model('RewardAuditLog', RewardAuditLogSchema)
exports.default = RewardAuditLog
