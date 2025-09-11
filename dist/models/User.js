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
function computeDivision(eloPoints) {
  const steps = Math.floor(eloPoints / 100)
  const tierIndex = Math.min(
    exports.TIERS.length - 1,
    Math.floor(steps / exports.RANKS.length)
  )
  const rankIndexFromLow = steps % exports.RANKS.length // 0..3 maps to ['IV','III','II','I']
  const tier = exports.TIERS[tierIndex]
  const rank =
    exports.RANKS[Math.min(rankIndexFromLow, exports.RANKS.length - 1)]
  return { tier, rank }
}
UserSchema.pre('save', function (next) {
  const self = this
  const { tier, rank } = computeDivision(self.eloPoints)
  self.divisionTier = tier
  self.divisionRank = rank
  next()
})
const User = mongoose_1.default.model('User', UserSchema)
exports.default = User
