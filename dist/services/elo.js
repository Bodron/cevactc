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
exports.getEloDelta = getEloDelta
exports.applyMatchResult = applyMatchResult
const User_1 = __importStar(require('../models/User'))
function getEloDelta(winnerElo, loserElo) {
  // Simple constant delta with small adjustment based on difference
  const gap = Math.max(-400, Math.min(400, winnerElo - loserElo))
  const adj = Math.round(-gap / 40) // if winner has less elo, gain slightly more
  const winnerGain = 25 + adj // base 25
  const loserLoss = 15 - Math.floor(adj / 2) // base 15
  return {
    winnerGain: Math.max(10, winnerGain),
    loserLoss: Math.max(5, loserLoss),
  }
}
async function applyMatchResult(winnerUserId, loserUserId) {
  const [winner, loser] = await Promise.all([
    User_1.default.findById(winnerUserId),
    User_1.default.findById(loserUserId),
  ])
  if (!winner || !loser) return
  const { winnerGain, loserLoss } = getEloDelta(
    winner.eloPoints,
    loser.eloPoints
  )
  winner.eloPoints = Math.max(0, winner.eloPoints + winnerGain)
  loser.eloPoints = Math.max(0, loser.eloPoints - loserLoss)
  // ranked stats
  winner.matches = (winner.matches || 0) + 1
  loser.matches = (loser.matches || 0) + 1
  winner.wins = (winner.wins || 0) + 1
  loser.losses = (loser.losses || 0) + 1
  const wDiv = (0, User_1.computeDivision)(winner.eloPoints)
  const lDiv = (0, User_1.computeDivision)(loser.eloPoints)
  winner.divisionTier = wDiv.tier
  winner.divisionRank = wDiv.rank
  loser.divisionTier = lDiv.tier
  loser.divisionRank = lDiv.rank
  await Promise.all([winner.save(), loser.save()])
  return {
    winner: {
      userId: winner.id,
      eloPoints: winner.eloPoints,
      divisionTier: winner.divisionTier,
      divisionRank: winner.divisionRank,
      delta: winnerGain,
    },
    loser: {
      userId: loser.id,
      eloPoints: loser.eloPoints,
      divisionTier: loser.divisionTier,
      divisionRank: loser.divisionRank,
      delta: -loserLoss,
    },
  }
}
