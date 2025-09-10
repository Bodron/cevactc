"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const User_1 = __importDefault(require("../models/User"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.get('/', async (req, res) => {
    try {
        const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
        const users = await User_1.default.find({}, {
            email: 1,
            displayName: 1,
            eloPoints: 1,
            divisionTier: 1,
            divisionRank: 1,
        })
            .sort({ eloPoints: -1, updatedAt: 1 })
            .limit(limit)
            .lean();
        return res.json({ leaderboard: users });
    }
    catch (err) {
        return res.status(500).json({ error: 'Failed to load leaderboard' });
    }
});
router.get('/me', auth_1.requireAuth, async (req, res) => {
    try {
        const userId = req.userId;
        const user = await User_1.default.findById(userId).lean();
        if (!user)
            return res.status(404).json({ error: 'Not found' });
        // compute rank index
        const betterCount = await User_1.default.countDocuments({ eloPoints: { $gt: user.eloPoints } });
        const rank = betterCount + 1;
        return res.json({
            rank,
            eloPoints: user.eloPoints,
            divisionTier: user.divisionTier,
            divisionRank: user.divisionRank,
        });
    }
    catch (err) {
        return res.status(500).json({ error: 'Failed to load rank' });
    }
});
exports.default = router;
