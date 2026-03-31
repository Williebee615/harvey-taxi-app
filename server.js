const express = require("express")
const cors = require("cors")
const fs = require("fs")
const path = require("path")

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static("public"))

const DATA_FILE = "data.json"

function loadData() {
if (!fs.existsSync(DATA_FILE)) {
fs.writeFileSync(DATA_FILE, JSON.stringify({ rides: [], drivers: [] }))
}
return JSON.parse(fs.readFileSync(DATA_FILE))
}

function saveData(data) {
fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function calculateFare() {
const base = 5
const perMile = 2
const booking = 2

const distance = Math.random() * 5 + 1

return {
distance: distance.toFixed(2),
subtotal: base + (distance * perMile),
booking,
total: (base + (distance * perMile) + booking).toFixed(2)
}
}

function getSurgeMultiplier(activeTrips) {
if (activeTrips >= 5) return 1.5
if (activeTrips >= 3) return 1.25
return 1
}

app.post("/api/request-ride", (req, res) => {

const data = loadData()

const fare = calculateFare()
const activeTrips = data.rides.filter(r => r.status === "assigned").length
const surge = getSurgeMultiplier(activeTrips)

const ride = {
id: Date.now(),
pickup: req.body.pickup,
dropoff: req.body.dropoff,
status: "waiting",
fare: fare,
surgeMultiplier: surge,
total: (fare.total * surge).toFixed(2),
driverId: null,
created: new Date()
}

const availableDriver = data.drivers.find(d => d.online)

if (availableDriver) {
ride.status = "assigned"
ride.driverId = availableDriver.id
}

data.rides.push(ride)
saveData(data)

res.json(ride)
})

app.get("/api/rides", (req, res) => {
const data = loadData()
res.json(data.rides)
})

app.post("/api/driver-online", (req, res) => {
const data = loadData()

let driver = data.drivers.find(d => d.id === req.body.id)

if (!driver) {
driver = {
id: req.body.id,
online: true
}
data.drivers.push(driver)
} else {
driver.online = true
}

saveData(data)
res.json({ success: true })
})

app.post("/api/driver-offline", (req, res) => {
const data = loadData()

const driver = data.drivers.find(d => d.id === req.body.id)
if (driver) driver.online = false

saveData(data)
res.json({ success: true })
})

app.listen(PORT, () => {
console.log("Server running on port " + PORT)
})
