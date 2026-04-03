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

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    return []
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

app.get('/api/status', (req, res) => {
  res.json({
    status: 'Harvey Taxi Dispatch Running',
    time: new Date()
  })
})

app.post('/api/request-ride', (req, res) => {
  const rides = readJson('rides.json')

  const ride = {
    id: Date.now(),
    pickup: req.body.pickup || '',
    dropoff: req.body.dropoff || '',
    rider: req.body.rider || '',
    phone: req.body.phone || '',
    status: 'waiting',
    driverId: null,
    driverName: null,
    acceptedAt: null,
    assignedAt: null,
    created: new Date()
  }

  rides.push(ride)
  writeJson('rides.json', rides)

  res.json({
    success: true,
    ride
  })
})

app.get('/api/rides', (req, res) => {
  res.json(readJson('rides.json'))
})

app.get('/api/available-rides', (req, res) => {
  const rides = readJson('rides.json')
  const available = rides.filter(ride => ride.status === 'waiting')
  res.json(available)
})

app.post('/api/rides/:id/accept', (req, res) => {
 
