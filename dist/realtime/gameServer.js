'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
exports.getRealtimeStatus = exports.attachGameServer = void 0
const uuid_1 = require('uuid')
const jsonwebtoken_1 = __importDefault(require('jsonwebtoken'))
const User_1 = __importDefault(require('../models/User'))
const gameLogic_1 = require('../utils/gameLogic')
const elo_1 = require('../services/elo')
const MatchHistory_1 = __importDefault(require('../models/MatchHistory'))
const DailyPlay_1 = __importDefault(require('../models/DailyPlay'))
const Season_1 = __importDefault(require('../models/Season'))
const THIRTY_SECONDS = 30000
const rateLimitSocket = require('./rateLimitSocket')
// Socket-level limiters:
const allowEnqueueRanked = rateLimitSocket.createLimiter({
  windowMs: 4000,
  max: 2,
})
const allowEnqueueCasual = rateLimitSocket.createLimiter({
  windowMs: 4000,
  max: 2,
})
const allowSetSecret = rateLimitSocket.createLimiter({ windowMs: 2000, max: 5 })
const allowGuess = rateLimitSocket.createLimiter({ windowMs: 2000, max: 5 })
const matchmakingQueue = []
const casualQueue = []
const socketIdToUserId = new Map()
const userIdToSocketId = new Map()
const liveMatches = new Map()
const liveRooms = new Map()
function verifySocketToken(socket) {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token
    if (!token || typeof token !== 'string') return undefined
    const secret = process.env.JWT_SECRET
    const payload = jsonwebtoken_1.default.verify(token, secret)
    return { userId: payload.userId, sessionId: payload.sessionId }
  } catch {
    return undefined
  }
}
async function buildPlayer(socket, userId) {
  if (userId && userId.startsWith('guest:')) {
    const short = userId.slice(-4).toUpperCase()
    const displayName = `Guest-${short}`
    return {
      socketId: socket.id,
      userId,
      displayName,
      timeLeftMs: THIRTY_SECONDS,
      eloPoints: 0,
      divisionTier: 'Bronze',
      divisionRank: 'IV',
    }
  }
  const user = await User_1.default.findById(userId).lean()
  const displayName = user?.displayName || 'Player'
  return {
    socketId: socket.id,
    userId,
    displayName,
    timeLeftMs: THIRTY_SECONDS,
    eloPoints: user?.eloPoints || 0,
    divisionTier: user?.divisionTier || 'Bronze',
    divisionRank: user?.divisionRank || 'IV',
    avatarAsset: user?.avatarAsset || null,
  }
}
function startMatch(io, p1, p2, isRanked = false, mode = 'casual') {
  const id = (0, uuid_1.v4)()
  const match = {
    id,
    players: [p1, p2],
    currentTurnIndex: 0,
    startedAtMs: Date.now(),
    countdownEndsAtMs: 0,
    isFinished: false,
    isRanked,
    mode,
    waitingForSecrets: true,
  }
  liveMatches.set(id, match)
  io.to(p1.socketId).emit('match.started', {
    matchId: id,
    ranked: isRanked,
    opponent: {
      displayName: p2.displayName,
      eloPoints: p2.eloPoints,
      divisionTier: p2.divisionTier,
      divisionRank: p2.divisionRank,
      avatarAsset: p2.avatarAsset || null,
    },
  })
  io.to(p2.socketId).emit('match.started', {
    matchId: id,
    ranked: isRanked,
    opponent: {
      displayName: p1.displayName,
      eloPoints: p1.eloPoints,
      divisionTier: p1.divisionTier,
      divisionRank: p1.divisionRank,
      avatarAsset: p1.avatarAsset || null,
    },
  })
  emitTurnUpdate(io, match)
  // If bot is in the match, ensure it can act when it's its turn
  scheduleBotTurn(io, match)
  return match
}
function emitTurnUpdate(io, match) {
  const current = match.players[match.currentTurnIndex]
  const opponent = match.players[1 - match.currentTurnIndex]
  const payload = {
    matchId: match.id,
    yourTurn: current.socketId,
    timeLeftMs:
      match.countdownEndsAtMs > 0
        ? Math.max(0, match.countdownEndsAtMs - Date.now())
        : 0,
    opponent: opponent.displayName,
    opponentTier: opponent.divisionTier,
    opponentRank: opponent.divisionRank,
    yourTier: current.divisionTier,
    yourRank: current.divisionRank,
    opponentAvatarAsset: opponent.avatarAsset || null,
    yourAvatarAsset: current.avatarAsset || null,
    lastGuess: opponent.lastGuess || null,
    lastFeedback: opponent.lastFeedback || null,
  }
  match.players.forEach((p) => {
    const isCurrent = p.socketId === current.socketId
    const other =
      match.players[p.socketId === match.players[0].socketId ? 1 : 0]
    const data = {
      ...payload,
      yourTurn: isCurrent,
      yourSecretSet: !!p.secret,
      opponentSecretSet: !!other.secret,
      waitingForSecrets: !!match.waitingForSecrets,
    }
    // personalize opponent/name/rank/avatar per recipient
    data.opponent = other.displayName
    data.yourTier = p.divisionTier
    data.yourRank = p.divisionRank
    data.opponentTier = other.divisionTier
    data.opponentRank = other.divisionRank
    data.yourAvatarAsset = p.avatarAsset || null
    data.opponentAvatarAsset = other.avatarAsset || null
    io.to(p.socketId).emit('match.turn', data)
  })
  // After sending turn updates, let the bot act if it's its turn
  scheduleBotTurn(io, match)
}
function switchTurn(match) {
  match.currentTurnIndex = match.currentTurnIndex === 0 ? 1 : 0
  match.countdownEndsAtMs = Date.now() + THIRTY_SECONDS
}
function findMatchBySocket(socketId) {
  for (const m of liveMatches.values()) {
    if (m.players.some((p) => p.socketId === socketId)) return m
  }
  return undefined
}
function endMatch(io, match, winnerIndex) {
  match.isFinished = true
  liveMatches.delete(match.id)
  if (winnerIndex === -1) {
    match.players.forEach((p) =>
      io.to(p.socketId).emit('match.ended', { result: 'draw' })
    )
    return
  }
  const winner = match.players[winnerIndex]
  const loser = match.players[1 - winnerIndex]
  if (!match.isRanked) {
    // Non-ranked rooms: emit result only, do not change elo/stats
    match.players.forEach((p) =>
      io.to(p.socketId).emit('match.ended', {
        result: p.userId === winner.userId ? 'win' : 'loss',
      })
    )
    // Track daily plays for casual/withFriends
    try {
      const day = new Date().toISOString().slice(0, 10)
      const modeKey = match.mode === 'withFriends' ? 'withFriends' : 'casual'
      const incA = { total: 1 }
      const incB = { total: 1 }
      incA[modeKey] = 1
      incB[modeKey] = 1
      const devA =
        io.sockets.sockets.get(winner.socketId)?.data?.deviceId || null
      const devB =
        io.sockets.sockets.get(loser.socketId)?.data?.deviceId || null
      const filterA = devA
        ? { deviceId: devA, day }
        : { userId: winner.userId, day }
      const filterB = devB
        ? { deviceId: devB, day }
        : { userId: loser.userId, day }
      DailyPlay_1.default
        .updateOne(
          filterA,
          {
            $inc: incA,
            $setOnInsert: { userId: winner.userId, deviceId: devA },
          },
          { upsert: true }
        )
        .catch(() => {})
      DailyPlay_1.default
        .updateOne(
          filterB,
          {
            $inc: incB,
            $setOnInsert: { userId: loser.userId, deviceId: devB },
          },
          { upsert: true }
        )
        .catch(() => {})
    } catch (_) {}
    return
  }
  ;(0, elo_1.applyMatchResult)(winner.userId, loser.userId)
    .then((result) => {
      match.players.forEach((p) => {
        const isWinner = p.userId === winner.userId
        io.to(p.socketId).emit('match.ended', {
          result: isWinner ? 'win' : 'loss',
          eloUpdate: result,
        })
      })
      // Persist ranked history (TTL 50 days)
      try {
        MatchHistory_1.default
          .create({
            player1Id: match.players[0].userId,
            player2Id: match.players[1].userId,
            winnerUserId: winner.userId,
            loserUserId: loser.userId,
            isRanked: true,
            mode: 'ranked',
            startedAt: new Date(match.startedAtMs || Date.now()),
            endedAt: new Date(),
            eloWinnerDelta: result?.winner?.delta || 0,
            eloLoserDelta: result?.loser?.delta || 0,
          })
          .catch(() => {})
      } catch (_) {}
      // Daily play counters for ranked
      try {
        const day = new Date().toISOString().slice(0, 10)
        const inc = { ranked: 1, total: 1 }
        const devA =
          io.sockets.sockets.get(winner.socketId)?.data?.deviceId || null
        const devB =
          io.sockets.sockets.get(loser.socketId)?.data?.deviceId || null
        const filterA = devA
          ? { deviceId: devA, day }
          : { userId: winner.userId, day }
        const filterB = devB
          ? { deviceId: devB, day }
          : { userId: loser.userId, day }
        DailyPlay_1.default
          .updateOne(
            filterA,
            {
              $inc: inc,
              $setOnInsert: { userId: winner.userId, deviceId: devA },
            },
            { upsert: true }
          )
          .catch(() => {})
        DailyPlay_1.default
          .updateOne(
            filterB,
            {
              $inc: inc,
              $setOnInsert: { userId: loser.userId, deviceId: devB },
            },
            { upsert: true }
          )
          .catch(() => {})
      } catch (_) {}
    })
    .catch(() => {
      match.players.forEach((p) =>
        io.to(p.socketId).emit('match.ended', {
          result: p.userId === winner.userId ? 'win' : 'loss',
        })
      )
    })
}
function attachGameServer(io) {
  setInterval(() => {
    const now = Date.now()
    for (const match of [...liveMatches.values()]) {
      if (match.isFinished) continue
      if (match.waitingForSecrets || match.countdownEndsAtMs <= 0) continue
      const remainingMs = Math.max(0, match.countdownEndsAtMs - now)
      match.players.forEach((p) => {
        io.to(p.socketId).emit('match.tick', {
          matchId: match.id,
          timeLeftMs: remainingMs,
          yourTurn:
            p.socketId === match.players[match.currentTurnIndex].socketId,
        })
      })
      if (now >= match.countdownEndsAtMs) {
        const timedOutIndex = match.currentTurnIndex
        match.players.forEach((p) =>
          io.to(p.socketId).emit('match.timeout', { timedOutIndex })
        )
        switchTurn(match)
        emitTurnUpdate(io, match)
      }
    }
  }, 250)
  io.on('connection', async (socket) => {
    let auth = verifySocketToken(socket)
    let userId = auth && auth.userId
    let sessionId = auth && auth.sessionId
    const deviceIdRaw =
      socket.handshake.auth?.deviceId || socket.handshake.query?.deviceId
    const deviceId =
      typeof deviceIdRaw === 'string' && deviceIdRaw.trim().length > 0
        ? String(deviceIdRaw).trim()
        : null
    if (!userId) {
      // allow guests for rooms, but they cannot play ranked
      userId = `guest:${(0, uuid_1.v4)()}`
    } else {
      // refresh auth if token changes on reconnect
      socket.data = socket.data || {}
      socket.data.userId = userId
    }
    socketIdToUserId.set(socket.id, userId)
    if (deviceId) {
      socket.data = socket.data || {}
      socket.data.deviceId = deviceId
    }
    if (!String(userId).startsWith('guest:')) {
      try {
        const user = await User_1.default.findById(userId).lean()
        if (
          user &&
          user.sessionId &&
          sessionId &&
          user.sessionId !== sessionId
        ) {
          // Token is stale: reject connection
          socket.emit('auth.kicked', { reason: 'session_revoked' })
          try {
            socket.disconnect(true)
          } catch (_) {}
          return
        }
        // Enforce single socket per user: disconnect previous
        const prev = userIdToSocketId.get(userId)
        if (prev && prev !== socket.id) {
          const prevSocket = io.sockets.sockets.get(prev)
          if (prevSocket) {
            try {
              prevSocket.emit('auth.kicked', { reason: 'another_login' })
            } catch (_) {}
            try {
              prevSocket.disconnect(true)
            } catch (_) {}
          }
        }
        userIdToSocketId.set(userId, socket.id)
      } catch (_) {}
    }
    socket.on('disconnect', () => {
      socketIdToUserId.delete(socket.id)
      const uid = socket.data?.userId || userId
      if (uid && userIdToSocketId.get(uid) === socket.id) {
        userIdToSocketId.delete(uid)
      }
      const idx = matchmakingQueue.indexOf(socket.id)
      if (idx >= 0) matchmakingQueue.splice(idx, 1)
      const cIdx = casualQueue.indexOf(socket.id)
      if (cIdx >= 0) casualQueue.splice(cIdx, 1)
      const match = findMatchBySocket(socket.id)
      if (match && !match.isFinished) {
        const winnerIndex = match.players[0].socketId === socket.id ? 1 : 0
        endMatch(io, match, winnerIndex)
      }
    })
    // allow client to refresh auth mapping without reconnect
    socket.on('auth.refresh', (payload) => {
      try {
        const token = payload?.token
        if (!token) return
        const secret = process.env.JWT_SECRET
        const payloadJwt = jsonwebtoken_1.default.verify(token, secret)
        const uid = payloadJwt.userId
        const sid = payloadJwt.sessionId
        if (!uid) return
        socket.data = socket.data || {}
        socket.data.userId = uid
        // Re-check session validity on refresh
        if (sid) {
          User_1.default
            .findById(uid)
            .lean()
            .then((u) => {
              if (u && u.sessionId && u.sessionId !== sid) {
                try {
                  socket.emit('auth.kicked', { reason: 'session_revoked' })
                } catch (_) {}
                try {
                  socket.disconnect(true)
                } catch (_) {}
              } else {
                // move mapping
                const prev = userIdToSocketId.get(uid)
                if (prev && prev !== socket.id) {
                  const prevSocket = io.sockets.sockets.get(prev)
                  if (prevSocket) {
                    try {
                      prevSocket.emit('auth.kicked', {
                        reason: 'another_login',
                      })
                    } catch (_) {}
                    try {
                      prevSocket.disconnect(true)
                    } catch (_) {}
                  }
                }
                userIdToSocketId.set(uid, socket.id)
              }
            })
            .catch(() => {})
        }
        socketIdToUserId.set(socket.id, uid)
      } catch (_) {}
    })
    socket.on('ranked.enqueue', async () => {
      if (!allowEnqueueRanked(socket, 'ranked.enqueue')) {
        socket.emit('match.error', { error: 'too_many_requests' })
        return
      }
      // Prevent ranked during pause windows
      const now = new Date()
      const active = await Season_1.default
        .findOne({
          startAt: { $lte: now },
          endAt: { $gte: now },
        })
        .lean()
      const paused = await Season_1.default
        .findOne({
          endAt: { $lt: now },
          payoutUntil: { $gte: now },
        })
        .lean()
      if (!active || paused) {
        socket.emit('match.error', { error: 'ranked_paused' })
        return
      }
      const uid = socketIdToUserId.get(socket.id) || socket.data?.userId || ''
      if (uid.startsWith('guest:')) {
        socket.emit('match.error', { error: 'auth_required' })
        return
      }
      if (matchmakingQueue.includes(socket.id)) return
      matchmakingQueue.push(socket.id)
      while (matchmakingQueue.length >= 2) {
        const s1 = matchmakingQueue.shift()
        const s2 = matchmakingQueue.shift()
        const sock1 = io.sockets.sockets.get(s1)
        const sock2 = io.sockets.sockets.get(s2)
        if (!sock1 || !sock2) continue
        const u1 = socketIdToUserId.get(s1)
        const u2 = socketIdToUserId.get(s2)
        const [p1, p2] = await Promise.all([
          buildPlayer(sock1, u1),
          buildPlayer(sock2, u2),
        ])
        startMatch(io, p1, p2, true, 'ranked')
      }
    })

    socket.on('casual.enqueue', async () => {
      if (!allowEnqueueCasual(socket, 'casual.enqueue')) return
      if (casualQueue.includes(socket.id)) return
      casualQueue.push(socket.id)
      // try to pair two real players first
      if (casualQueue.length >= 2) {
        const s1 = casualQueue.shift()
        const s2 = casualQueue.shift()
        const sock1 = io.sockets.sockets.get(s1)
        const sock2 = io.sockets.sockets.get(s2)
        if (sock1 && sock2) {
          const u1 = socketIdToUserId.get(s1)
          const u2 = socketIdToUserId.get(s2)
          const [p1, p2] = await Promise.all([
            buildPlayer(sock1, u1),
            buildPlayer(sock2, u2),
          ])
          startMatch(io, p1, p2, false, 'casual')
          return
        }
      }
      // fallback with bot after short wait if no opponent
      setTimeout(async () => {
        const idx = casualQueue.indexOf(socket.id)
        if (idx === -1) return
        // no opponent found, remove from queue and start vs bot
        casualQueue.splice(idx, 1)
        const uid = socketIdToUserId.get(socket.id) || socket.data?.userId
        const human = await buildPlayer(socket, uid)
        const bot = {
          socketId: `bot:${(0, uuid_1.v4)()}`,
          userId: 'bot:medium',
          displayName: 'CPU (Medium)',
          timeLeftMs: THIRTY_SECONDS,
          eloPoints: 0,
          divisionTier: 'Bronze',
          divisionRank: 'IV',
          avatarAsset: null,
          // bot state
          secret: String(Math.floor(1000 + Math.random() * 9000)),
        }
        const match = startMatch(io, human, bot, false, 'casual')
        // mark waiting for secrets; human must set, bot already has
        match.waitingForSecrets = true
        // when human sets secret, game can start; rest of flow already handled
      }, 700)
    })
    socket.on('match.setSecret', (payload) => {
      if (!allowSetSecret(socket, 'match.setSecret')) return
      const match = findMatchBySocket(socket.id)
      if (!match || match.isFinished) return
      if (!(0, gameLogic_1.isValidCode)(payload?.secret)) {
        socket.emit('error', { error: 'invalid_secret' })
        socket.emit('match.error', { error: 'invalid_secret' })
        return
      }
      const player = match.players.find((p) => p.socketId === socket.id)
      player.secret = payload.secret
      socket.emit('match.secretSet')
      // broadcast secret status to both players
      match.players.forEach((p) => {
        const other =
          match.players[p.socketId === match.players[0].socketId ? 1 : 0]
        io.to(p.socketId).emit('match.secretStatus', {
          yourSecretSet: !!p.secret,
          opponentSecretSet: !!other.secret,
        })
      })
      if (match.waitingForSecrets) {
        const bothSet = !!match.players[0].secret && !!match.players[1].secret
        if (bothSet) {
          match.waitingForSecrets = false
          match.countdownEndsAtMs = Date.now() + THIRTY_SECONDS
          emitTurnUpdate(io, match)
          scheduleBotTurn(io, match)
        }
      }
    })
    socket.on('match.guess', (payload) => {
      if (!allowGuess(socket, 'match.guess')) return
      const match = findMatchBySocket(socket.id)
      if (!match || match.isFinished) return
      if (match.waitingForSecrets || match.countdownEndsAtMs <= 0) {
        socket.emit('match.error', { error: 'secrets_not_ready' })
        return
      }
      const current = match.players[match.currentTurnIndex]
      if (current.socketId !== socket.id) {
        socket.emit('error', { error: 'not_your_turn' })
        socket.emit('match.error', { error: 'not_your_turn' })
        return
      }
      const opponent = match.players[1 - match.currentTurnIndex]
      if (!opponent.secret) {
        socket.emit('error', { error: 'opponent_secret_not_set' })
        socket.emit('match.error', { error: 'opponent_secret_not_set' })
        return
      }
      const guess = String(payload?.guess || '')
      if (!(0, gameLogic_1.isValidCode)(guess)) {
        socket.emit('error', { error: 'invalid_guess' })
        socket.emit('match.error', { error: 'invalid_guess' })
        return
      }
      const feedback = (0, gameLogic_1.evaluateGuess)(opponent.secret, guess)
      current.lastGuess = guess
      current.lastFeedback = feedback
      io.to(current.socketId).emit('match.guessResult', { guess, feedback })
      io.to(opponent.socketId).emit('match.opponentGuessed', {
        guess,
        feedback,
      })
      if (feedback.correctPositions === 4) {
        const winnerIndex = match.currentTurnIndex
        endMatch(io, match, winnerIndex)
        return
      }
      switchTurn(match)
      emitTurnUpdate(io, match)
      scheduleBotTurn(io, match)
    })
    socket.on('match.leave', () => {
      const match = findMatchBySocket(socket.id)
      if (!match || match.isFinished) return
      const leaverIndex = match.players[0].socketId === socket.id ? 0 : 1
      const winnerIndex = leaverIndex === 0 ? 1 : 0
      endMatch(io, match, winnerIndex)
    })
    socket.on('room.create', async (payload, cb) => {
      // 6-digit numeric room id, unique
      let id = String(Math.floor(100000 + Math.random() * 900000))
      while (liveRooms.has(id)) {
        id = String(Math.floor(100000 + Math.random() * 900000))
      }
      const room = {
        id,
        name: payload?.name || 'Room',
        hostUserId: userId,
        players: [await buildPlayer(socket, userId)],
      }
      liveRooms.set(id, room)
      // notify creator of room status
      io.to(socket.id).emit('room.status', {
        roomId: id,
        players: room.players.map((p) => p.displayName),
        youAreHost: true,
      })
      cb?.({ roomId: id })
    })
    socket.on('room.join', async (payload, cb) => {
      const room = liveRooms.get(payload?.roomId)
      if (!room) {
        cb?.({ error: 'not_found' })
        return
      }
      if (room.players.length >= 2) {
        cb?.({ error: 'full' })
        return
      }
      const player = await buildPlayer(socket, userId)
      room.players.push(player)
      cb?.({ ok: true })
      room.players.forEach((p) =>
        io.to(p.socketId).emit('room.status', {
          roomId: room.id,
          players: room.players.map((pp) => pp.displayName),
          youAreHost: room.hostUserId === socketIdToUserId.get(p.socketId),
        })
      )
    })
    socket.on('room.start', () => {
      const room = [...liveRooms.values()].find((r) =>
        r.players.some((p) => p.socketId === socket.id)
      )
      if (!room) return
      const starterUserId = socketIdToUserId.get(socket.id)
      if (!starterUserId || starterUserId !== room.hostUserId) {
        io.to(socket.id).emit('room.error', { error: 'not_host' })
        return
      }
      if (room.players.length !== 2) {
        io.to(socket.id).emit('room.error', { error: 'need_two_players' })
        return
      }
      const match = startMatch(
        io,
        room.players[0],
        room.players[1],
        false,
        'withFriends'
      )
      room.match = match
    })
  })
}
exports.attachGameServer = attachGameServer
function getRealtimeStatus() {
  return {
    players: (() => {
      try {
        let count = 0
        for (const uid of socketIdToUserId.values()) {
          if (typeof uid === 'string' && !uid.startsWith('guest:')) count++
        }
        return count
      } catch (_) {
        return socketIdToUserId.size
      }
    })(),
    rooms: liveRooms.size,
    matches: liveMatches.size,
    queue: matchmakingQueue.length,
  }
}
exports.getRealtimeStatus = getRealtimeStatus

function isBotPlayer(p) {
  try {
    return typeof p.userId === 'string' && p.userId.startsWith('bot:')
  } catch (_) {
    return false
  }
}

function scheduleBotTurn(io, match) {
  try {
    if (!match || match.isFinished || match.waitingForSecrets) return
    const current = match.players[match.currentTurnIndex]
    if (!isBotPlayer(current)) return
    if (match.botTimer) {
      clearTimeout(match.botTimer)
      match.botTimer = null
    }
    const opponent = match.players[1 - match.currentTurnIndex]
    if (!opponent.secret) return
    match.botGuessedSet = match.botGuessedSet || new Set()
    match.botHistory = match.botHistory || []
    match.botCandidates = match.botCandidates || generateAllCodes()
    // reduce candidates by applying all previous feedback constraints
    try {
      let cands = match.botCandidates
      for (const h of match.botHistory) {
        cands = cands.filter((code) =>
          isFeedbackConsistent(code, h.guess, h.feedback)
        )
      }
      match.botCandidates = cands
    } catch (_) {}
    match.botTimer = setTimeout(() => {
      if (!match || match.isFinished || match.waitingForSecrets) return
      // choose next guess from remaining candidates; fallback to random unseen
      let guess = '0123'
      const pool = (match.botCandidates || []).filter(
        (g) => !match.botGuessedSet.has(g)
      )
      if (pool.length > 0) {
        guess = pool[0]
      } else {
        for (let tries = 0; tries < 10000; tries++) {
          const g = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
          if (!match.botGuessedSet.has(g)) {
            guess = g
            break
          }
        }
      }
      match.botGuessedSet.add(guess)
      const feedback = (0, gameLogic_1.evaluateGuess)(opponent.secret, guess)
      current.lastGuess = guess
      current.lastFeedback = feedback
      // keep history for next reduction round
      try {
        match.botHistory.push({ guess, feedback })
      } catch (_) {}
      // Notify only the human opponent (bot has no socket)
      io.to(opponent.socketId).emit('match.opponentGuessed', {
        guess,
        feedback,
      })
      if (feedback.correctPositions === 4) {
        endMatch(io, match, match.currentTurnIndex)
        return
      }
      switchTurn(match)
      emitTurnUpdate(io, match)
    }, 1000 + Math.floor(Math.random() * 1000))
  } catch (_) {}
}

function generateAllCodes() {
  const arr = []
  for (let i = 0; i < 10000; i++) arr.push(String(i).padStart(4, '0'))
  return arr
}

function isFeedbackConsistent(secretCandidate, guess, expected) {
  try {
    const fb = (0, gameLogic_1.evaluateGuess)(secretCandidate, guess)
    return (
      fb.correctPositions === expected.correctPositions &&
      fb.correctDigits === expected.correctDigits
    )
  } catch (_) {
    return false
  }
}
