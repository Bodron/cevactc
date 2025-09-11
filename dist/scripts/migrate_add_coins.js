'use strict'
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../.env') })
const mongoose = require('mongoose')

async function main() {
  const mongoUri =
    process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/crackthecode'
  await mongoose.connect(mongoUri)
  console.log('[migrate] connected to MongoDB')

  const userSchema = new mongoose.Schema({}, { strict: false })
  const User = mongoose.model('User', userSchema, 'users')

  const res = await User.updateMany(
    { coins: { $exists: false } },
    { $set: { coins: 0 } }
  )
  console.log(
    '[migrate] updated %d users (set coins=0 where missing)',
    res.modifiedCount
  )
  await mongoose.disconnect()
}

main()
  .then(() => {
    console.log('[migrate] done')
    process.exit(0)
  })
  .catch((err) => {
    console.error('[migrate] error', err)
    process.exit(1)
  })
