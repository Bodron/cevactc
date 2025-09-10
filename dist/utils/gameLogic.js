"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidCode = isValidCode;
exports.evaluateGuess = evaluateGuess;
function isValidCode(code) {
    return /^[0-9]{4}$/.test(code);
}
function evaluateGuess(secret, guess) {
    if (secret.length !== 4 || guess.length !== 4)
        return { correctPositions: 0, correctDigits: 0 };
    let correctPositions = 0;
    const secretCounts = {};
    const guessCounts = {};
    for (let i = 0; i < 4; i++) {
        if (secret[i] === guess[i]) {
            correctPositions++;
        }
        else {
            secretCounts[secret[i]] = (secretCounts[secret[i]] || 0) + 1;
            guessCounts[guess[i]] = (guessCounts[guess[i]] || 0) + 1;
        }
    }
    let matchesAnywhere = 0;
    for (const digit in guessCounts) {
        if (secretCounts[digit]) {
            matchesAnywhere += Math.min(secretCounts[digit], guessCounts[digit]);
        }
    }
    return { correctPositions, correctDigits: correctPositions + matchesAnywhere };
}
