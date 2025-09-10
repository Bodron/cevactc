'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
const mongoose_1 = __importDefault(require('mongoose'))

// Store ranked match history with TTL of 50 days
const MatchHistorySchema = new mongoose_1.default.Schema(
  {
    player1Id: { type: String, required: true, index: true },
    player2Id: { type: String, required: true, index: true },
    winnerUserId: { type: String, required: true, index: true },
    loserUserId: { type: String, required: true, index: true },
    mode: { type: String, default: 'ranked', index: true },
    isRanked: { type: Boolean, default: true, index: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: true },
    // TTL index via expires (seconds)
    createdAt: { type: Date, default: Date.now, expires: 50 * 24 * 60 * 60 },
    // Optional ELO deltas snapshot
    eloWinnerDelta: { type: Number, default: 0 },
    eloLoserDelta: { type: Number, default: 0 },
  },
  { timestamps: false }
)

const MatchHistory = mongoose_1.default.model(
  'MatchHistory',
  MatchHistorySchema
)
exports.default = MatchHistory
