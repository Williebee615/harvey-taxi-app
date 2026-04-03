const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'))
})

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return []
  }
}

function write(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

/* -------------------------
   STATUS
--------------------------*/
app.get('/api/status', (req, res) => {
  res.json({
    status: 'Harvey Taxi Running',
    time: new Date()
  })
})

/* -------------------------
   RIDER SIGNUP
--------------------------*/
app.post('/api/rider-signup', (req, res) => {
  const riders = read('riders.json')

  const rider = {
    id: Date.now(),
    name: req.body.name || '',
    phone: req.body.phone || '',
    email: req.body.email || '',
    city: req.body.city || '',
    created: new Date()
  }

  riders.push(rider)
  write('riders.json', riders)

  res.json({
    success: true
