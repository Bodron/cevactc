'use strict'
const mongoose = require('mongoose')

const DeleteRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    email: { type: String, index: true },
    type: {
      type: String,
      enum: ['delete_account', 'delete_data'],
      required: true,
    },
    notes: { type: String },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'rejected'],
      default: 'pending',
      index: true,
    },
    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    audit: [
      {
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        action: { type: String },
        note: { type: String },
      },
    ],
  },
  { timestamps: true }
)

module.exports = mongoose.model('DeleteRequest', DeleteRequestSchema)
