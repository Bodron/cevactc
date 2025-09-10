'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
const mongoose_1 = __importDefault(require('mongoose'))
const SeasonSchema = new mongoose_1.default.Schema(
  {
    name: { type: String, required: true, unique: true },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true, index: true },
    payoutUntil: { type: Date, default: null },
    snapshotDone: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
)
const Season = mongoose_1.default.model('Season', SeasonSchema)
exports.default = Season
