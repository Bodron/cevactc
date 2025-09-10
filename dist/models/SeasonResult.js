'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
const mongoose_1 = __importDefault(require('mongoose'))
const SeasonResultSchema = new mongoose_1.default.Schema(
  {
    seasonName: { type: String, required: true, index: true },
    userId: {
      type: mongoose_1.default.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    finalRank: { type: Number, required: true },
    eloPoints: { type: Number, required: true },
    divisionTier: { type: String, default: 'Bronze' },
    divisionRank: { type: String, default: 'IV' },
    divisionPlace: { type: Number, default: 0 },
  },
  { timestamps: true }
)
SeasonResultSchema.index({ seasonName: 1, userId: 1 }, { unique: true })
const SeasonResult = mongoose_1.default.model(
  'SeasonResult',
  SeasonResultSchema
)
exports.default = SeasonResult
