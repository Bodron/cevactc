'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
const mongoose = require('mongoose')

const GiftCardSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true }, // e.g., Amazon, Apple, Google
    currency: { type: String, default: 'USD' },
    value: { type: Number, required: true },
    codeEncrypted: { type: String, required: true },
    codeLast4: { type: String, required: true },
    assignedToRewardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Reward',
      default: null,
      index: true,
    },
    assignedAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
)

const GiftCard = mongoose.model('GiftCard', GiftCardSchema)
exports.default = GiftCard
