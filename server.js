const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())

const DATA_FILE = path.join(__dirname, 'data.json')

// initialize storage
if (!fs.existsSync(DATA_FILE)) {
fs.writeFileSync(DATA_FILE, JSON.stringify({
rides: [],
drivers: [],
riders: []
}, null, 2))
}

function readData() {
return JSON.parse(fs.readFileSync(DATA_FILE))
}

function writeData(data) {
fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

app.use(express.static(path.join(__dirname, 'public')))

app.get('/', (req,res)=>{
res.sendFile(path.join(__dirname,'public/index.html'))
})

/* =========================
   REQUEST RIDE
========================= */
app.post('/api/request-ride', (req,res)=>{
const data = readData()

const ride = {
id: Date.now().toString(),
pickup: req.body.pickup,
dropoff: req.body.dropoff,
rider: req.body.rider,
status: 'requested',
driverId: null,
created: new Date()
}

data.rides.push(ride)
writeData(data)

res.json(ride)
})

/* =========================
   GET RIDES
========================= */
app.get('/api/rides', (req,res)=>{
const data = readData()
res.json(data.rides)
})

/* =========================
   ASSIGN DRIVER
========================= */
app.post('/api/assign-driver', (req,res)=>{
const { rideId, driverId } = req.body
const data = readData()

const ride = data.rides.find(r=>r.id===rideId)

if(!ride) return res.status(404).json({error:'Ride not found'})

ride.driverId = driverId
ride.status = 'assigned'

writeData(data)
res.json(ride)
})

/* =========================
   DRIVER ACCEPT
========================= */
app.post('/api/driver-accept', (req,res)=>{
const { rideId } = req.body
const data = readData()

const ride = data.rides.find(r=>r.id===rideId)

if(!ride) return res.status(404).json({error:'Ride not found'})

ride.status = 'enroute'

writeData(data)
res.json(ride)
})

/* =========================
   START TRIP
========================= */
app.post('/api/start-trip', (req,res)=>{
const { rideId } = req.body
const data = readData()

const ride = data.rides.find(r=>r.id===rideId)

if(!ride) return res.status(404).json({error:'Ride not found'})

ride.status = 'in_progress'

writeData(data)
res.json(ride)
})

/* =========================
   COMPLETE TRIP
========================= */
app.post('/api/complete-trip', (req,res)=>{
const { rideId } = req.body
const data = readData()

const ride = data.rides.find(r=>r.id===rideId)

if(!ride) return res.status(404).json({error:'Ride not found'})

ride.status = 'completed'

writeData(data)
res.json(ride)
})

app.listen(PORT, ()=>{
console.log("Server running on port",PORT)
})
