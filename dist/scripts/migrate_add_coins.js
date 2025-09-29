'use strict'
const fs = require('fs')
const path = require('path')
// Load env from server/.env (project root) or local
;(function loadEnv() {
  const candidates = [
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../.env'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      require('dotenv').config({ path: p })
      console.log('[migrate] loaded env from', p)
      return
    }
  }
  require('dotenv').config()
  console.log('[migrate] loaded env from CWD')
})()
const mongoose = require('mongoose')

async function main() {
  const mongoUri =
    process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/crackthecode'
  await mongoose.connect(mongoUri)
  console.log('[migrate] connected to MongoDB')

  const userSchema = new mongoose.Schema({}, { strict: false })
  const User = mongoose.model('User', userSchema, 'users')

  // 1) Add coins=0 where field is missing entirely
  const resMissing = await User.updateMany(
    { coins: { $exists: false } },
    { $set: { coins: 0 } }
  )
  console.log('[migrate] coins missing → set 0:', resMissing.modifiedCount)

  // 2) Normalize coins=null to 0
  const resNull = await User.updateMany({ coins: null }, { $set: { coins: 0 } })
  console.log('[migrate] coins null → set 0:', resNull.modifiedCount)

  // 3) Normalize non-numeric values to 0 (strings/arrays/objects/bools)
  //    Using $expr to check the BSON type of the field
  const nonNumericFilter = {
    $expr: {
      $and: [
        { $ne: ['$coins', null] },
        {
          $not: {
            $in: [{ $type: '$coins' }, ['int', 'long', 'double', 'decimal']],
          },
        },
      ],
    },
  }
  const resNonNumeric = await User.updateMany(nonNumericFilter, {
    $set: { coins: 0 },
  })
  console.log(
    '[migrate] coins non-numeric → set 0:',
    resNonNumeric.modifiedCount
  )
  // Summary
  const total = await User.countDocuments({})
  const missingAfter = await User.countDocuments({ coins: { $exists: false } })
  const nullAfter = await User.countDocuments({ coins: null })
  console.log('[migrate] total users:', total)
  console.log('[migrate] remaining missing:', missingAfter)
  console.log('[migrate] remaining null:', nullAfter)
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
