'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../.env') })
if (!process.env.MONGO_URI) {
  console.warn(
    '[env] MONGO_URI nu este setat – se folosește fallback-ul local!'
  )
}
console.log('[config] PORT=', process.env.PORT || 4000)
console.log(
  '[config] MONGO_URI=',
  (process.env.MONGO_URI || '').replace(/\/\/.*@/, '//***@')
) // ascunde user:pass

const express_1 = __importDefault(require('express'))
const http_1 = __importDefault(require('http'))
const cors_1 = __importDefault(require('cors'))
const socket_io_1 = require('socket.io')
const mongoose_1 = __importDefault(require('mongoose'))
const auth_1 = __importDefault(require('./routes/auth'))
const leaderboard_1 = __importDefault(require('./routes/leaderboard'))
const seasons_1 = __importDefault(require('./routes/seasons'))
const notifications_1 = __importDefault(require('./routes/notifications'))
const gameServer_1 = require('./realtime/gameServer')
const Season_1 = __importDefault(require('./models/Season'))
const SeasonResult_1 = __importDefault(require('./models/SeasonResult'))
const User_1 = __importDefault(require('./models/User'))
const app = (0, express_1.default)()
app.use((0, cors_1.default)())
app.use(express_1.default.json())
app.get('/', (_req, res) => {
  res.json({ status: 'ok', name: 'Crack The Code API' })
})
app.get('/api/realtime/health', (_req, res) => {
  try {
    res.json({ status: 'ok', ...(0, gameServer_1.getRealtimeStatus)() })
  } catch (e) {
    res.status(500).json({ status: 'error' })
  }
})
// Deep-link redirector: opens app via custom scheme from a HTTPS link
app.get(['/link/reset', '/reset'], (req, res) => {
  try {
    const token = encodeURIComponent(String(req.query.token || ''))
    const appUrl = `crackthecode://reset?token=${token}`
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Open in app</title>
  <style>body{background:#000;color:#fff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:24px;text-align:center}a.btn{display:inline-block;margin-top:16px;padding:12px 18px;border:1px solid rgba(255,255,255,.25);border-radius:12px;color:#fff;text-decoration:none;background:rgba(255,255,255,.06)}</style>
  <script>
    function openApp(){ window.location.href='${appUrl}'; }
    document.addEventListener('DOMContentLoaded', function(){
      // try auto-open; some in-app browsers blochează, dar păstrăm butonul activ
      openApp();
      setTimeout(openApp, 800);
      setTimeout(function(){ document.getElementById('fb').style.display='block'; }, 1200);
    });
  </script>
</head>
<body>
  <h3>Opening CrackTheCode…</h3>
  <a class="btn" href="${appUrl}">Open in app now</a>
  <p id="fb" style="display:none;margin-top:10px;opacity:.8">If nothing happens, tap the button above.</p>
</body>
</html>`)
  } catch (_) {
    res.status(400).send('Invalid link')
  }
})
app.use('/api/auth', auth_1.default)
app.use('/api/leaderboard', leaderboard_1.default)
app.use('/api/seasons', seasons_1.default)
app.use('/api/notifications', notifications_1.default)
const server = http_1.default.createServer(app)
const io = new socket_io_1.Server(server, {
  cors: { origin: '*' },
})
;(0, gameServer_1.attachGameServer)(io)
const PORT = process.env.PORT || 4000
const MONGO_URI =
  process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/crackthecode'
async function start() {
  try {
    await mongoose_1.default.connect(MONGO_URI)
    console.log('Connected to MongoDB')
    // background job: finalize seasons automatically when ended and not snapshotDone
    setInterval(async () => {
      try {
        const now = new Date()
        const toFinalize = await Season_1.default
          .find({ endAt: { $lt: now }, snapshotDone: { $ne: true } })
          .lean()
        for (const s of toFinalize) {
          const users = await User_1.default
            .find(
              {},
              { _id: 1, eloPoints: 1, divisionTier: 1, divisionRank: 1 }
            )
            .sort({ eloPoints: -1, updatedAt: 1 })
            .lean()
          let rank = 1
          for (const u of users) {
            await SeasonResult_1.default.updateOne(
              { seasonName: s.name, userId: u._id },
              {
                $set: {
                  finalRank: rank,
                  eloPoints: u.eloPoints,
                  divisionTier: u.divisionTier || 'Bronze',
                  divisionRank: u.divisionRank || 'IV',
                  divisionPlace: rank,
                },
              },
              { upsert: true }
            )
            rank++
          }
          await Season_1.default.updateOne(
            { _id: s._id },
            { $set: { snapshotDone: true } }
          )
          console.log('Season snapshot finalized:', s.name)
        }
      } catch (_) {}
    }, 60 * 1000)
    server.listen(PORT, () => {
      console.log(`Server listening on :${PORT}`)
    })
  } catch (err) {
    console.error('Failed to start server', err)
    process.exit(1)
  }
}
start()
