const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())

// serve public folder
app.use(express.static(path.join(__dirname, 'public')))

// admin credentials
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@harveytaxi.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'HarveyAdmin123!'

// root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'))
})

// dynamic fallback for pages
app.get('/:page', (req, res) => {
  const file = path.join(__dirname, 'public', req.params.page)

  if (fs.existsSync(file)) {
    res.sendFile(file)
  } else {
    res.sendFile(path.join(__dirname, 'public/index.html'))
  }
})

/* ===============================
   ADMIN LOGIN
================================= */

app.post('/api/admin-login', (req, res) => {
  const { email, password } = req.body || {}

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    return res.json({
      success: true
    })
  }

  res.status(401).json({
    success: false,
    message: 'Invalid admin login'
  })
})

/* ===============================
   START SERVER
================================= */

app.listen(PORT, () => {
  console.log(`Harvey Taxi running on port ${PORT}`)
})
