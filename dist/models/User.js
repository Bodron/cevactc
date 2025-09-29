'use strict'
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k
        var desc = Object.getOwnPropertyDescriptor(m, k)
        if (
          !desc ||
          ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k]
            },
          }
        }
        Object.defineProperty(o, k2, desc)
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k
        o[k2] = m[k]
      })
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, 'default', { enumerable: true, value: v })
      }
    : function (o, v) {
        o['default'] = v
      })
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = []
          for (var k in o)
            if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k
          return ar
        }
      return ownKeys(o)
    }
    return function (mod) {
      if (mod && mod.__esModule) return mod
      var result = {}
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== 'default') __createBinding(result, mod, k[i])
      __setModuleDefault(result, mod)
      return result
    }
  })()
Object.defineProperty(exports, '__esModule', { value: true })
exports.RANKS = exports.TIERS = void 0
exports.computeDivision = computeDivision
const mongoose_1 = __importStar(require('mongoose'))
const UserSchema = new mongoose_1.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true },
    role: { type: String, default: 'User', index: true },
    eloPoints: { type: Number, default: 0, index: true },
    divisionTier: { type: String, default: 'Bronze', index: true },
    divisionRank: { type: String, default: 'IV', index: true },
    avatarAsset: { type: String, default: null },
    sessionId: { type: String, default: null },
    matches: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    // Live Top 250 placement (1..250). Null if not in Top250
    elitePlace: { type: Number, default: null, index: true },
    // Economy
    coins: { type: Number, default: 0 },
    // Compliance fields
    acceptedTerms: { type: Boolean, default: false },
    acceptedAt: { type: Date, default: null },
    ageDeclaration: { type: Boolean, default: false },
    // Password reset flow: token + expiry (short-lived)
    resetToken: { type: String, default: null, index: true },
    resetExpires: { type: Date, default: null },
  },
  { timestamps: true }
)
exports.TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond']
exports.RANKS = ['IV', 'III', 'II', 'I']
// Tier starting thresholds (points at which you become IV for that tier)
const TIER_START = {
  Bronze: 0,
  Silver: 401,
  Gold: 801,
  Platinum: 1201,
  Diamond: 1601,
}
function computeDivision(eloPoints) {
  // Determine tier by threshold
  let tier = 'Bronze'
  if (eloPoints >= TIER_START.Diamond) tier = 'Diamond'
  else if (eloPoints >= TIER_START.Platinum) tier = 'Platinum'
  else if (eloPoints >= TIER_START.Gold) tier = 'Gold'
  else if (eloPoints >= TIER_START.Silver) tier = 'Silver'

  // Offset inside the tier
  const start = TIER_START[tier]
  const offset = Math.max(0, Math.floor(eloPoints - start))
  // Every 100 points promotes one rank: 0-99 -> IV, 100-199 -> III, 200-299 -> II, 300+ -> I
  let rankIdx = Math.min(3, Math.floor(offset / 100))
  const rank = exports.RANKS[rankIdx]
  return { tier, rank }
}
UserSchema.pre('save', function (next) {
  const self = this
  // Do not override explicit Top250 assignment here; it is managed by a separate job
  if (self.divisionTier === 'Top250') {
    return next()
  }
  const { tier, rank } = computeDivision(self.eloPoints)
  self.divisionTier = tier
  self.divisionRank = rank
  next()
})
const User = mongoose_1.default.model('User', UserSchema)
exports.default = User
