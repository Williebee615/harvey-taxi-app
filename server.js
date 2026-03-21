const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ✅ SAFE ADMIN CONFIG
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "Williebee@harveytaxiservice.com"
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Jakurean870$"
const ADMIN_SECRET_PATH = process.env.ADMIN_SECRET_PATH || "control-center-879"

let drivers = []
let serviceRequests = []

let users = {
  riders: [],
  drivers: [],
  admins: [
    {
      id: 'admin_1',
      name: 'Harvey Admin',
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    }
  ]
}

// ADMIN LOGIN
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    return res.json({ success: true })
  }

  return res.status(401).json({ success: false })
})

// ADMIN PAGE (HIDDEN)
app.get(`/${ADMIN_SECRET_PATH}`, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'))
})

// TEST ROUTE (IMPORTANT FOR DEBUG)
app.get('/test', (req, res) => {
  res.send('Server is working ✅')
})

// DEFAULT ROUTE
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'))
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
