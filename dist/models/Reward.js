'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
const mongoose = require('mongoose')

const RewardSchema = new mongoose.Schema(
  {
    seasonName: { type: String, required: true, index: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    rank: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'claimed', 'expired'],
      default: 'pending',
      index: true,
    },
    isClaimed: { type: Boolean, default: false },
    claimTokenHash: { type: String, default: null },
    claimTokenExpiresAt: { type: Date, default: null },
    claimedAt: { type: Date, default: null },
    claimedIp: { type: String, default: null },
    claimedUserAgent: { type: String, default: null },
    emailSentAt: { type: Date, default: null },
  },
  { timestamps: true }
)
RewardSchema.index({ seasonName: 1, userId: 1 }, { unique: true })
const Reward = mongoose.model('Reward', RewardSchema)
exports.default = Reward
