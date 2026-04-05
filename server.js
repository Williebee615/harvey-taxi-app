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

app.get('/:page', (req, res) => {
const file = path.join(__dirname, 'public', req.params.page)

if (fs.existsSync(file)) {
res.sendFile(file)
} else {
res.sendFile(path.join(__dirname, 'public/index.html'))
}
})

/* ---------------------------
   DISPATCH MEMORY
----------------------------*/

let rides = []
let drivers = [
{
id: "driver_1",
name: "Nearest Driver",
lat: 36.1627,
lng: -86.7816,
available: true,
type: "human",
vehicle_type: "sedan"
},
{
id: "driver_2",
name: "Autonomous Unit A1",
lat: 36.1744,
lng: -86.7679,
available: true,
type: "av",
vehicle_type: "autonomous"
}
]

/* ---------------------------
   GEOCODE (SAFE VERSION)
----------------------------*/

async function geocodeAddress(address) {

try {

if (!process.env.GOOGLE_MAPS_KEY) {
return fallbackCoordinates(address)
}

const response = await fetch(
`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_KEY}`
)

const data = await response.json()

if (data.status === "OK") {
return {
lat: data.results[0].geometry.location.lat,
lng: data.results[0].geometry.location.lng
}
}

return fallbackCoordinates(address)

} catch (e) {
return fallbackCoordinates(address)
}

}

/* ---------------------------
   FALLBACK COORDINATES
----------------------------*/

function fallbackCoordinates(address) {

const baseLat = 36.1627
const baseLng = -86.7816

const hash = address
.split('')
.reduce((acc, char) => acc + char.charCodeAt(0), 0)

return {
lat: baseLat + (hash % 100) * 0.0001,
lng: baseLng + (hash % 100) * 0.0001
}

}

/* ---------------------------
   DISTANCE
----------------------------*/

function distance(a, b) {

const dx = a.lat - b.lat
const dy = a.lng - b.lng

return Math.sqrt(dx * dx + dy * dy)

}

/* ---------------------------
   DISPATCH BRAIN
----------------------------*/

function findNearestDriver(pickupCoords) {

let best = null
let bestDistance = Infinity

drivers.forEach(driver => {

if (!driver.available) return

const d = distance(pickupCoords, driver)

if (d < bestDistance) {
best = driver
bestDistance = d
}

})

return best

}

/* ---------------------------
   REQUEST RIDE
----------------------------*/

app.post('/api/request-ride', async (req, res) => {

const {
rider_name,
rider_phone,
pickup_address,
dropoff_address
} = req.body

if (!rider_name || !pickup_address || !dropoff_address) {
return res.status(400).json({
error: "Missing required fields"
})
}

const pickupCoords = await geocodeAddress(pickup_address)
const dropoffCoords = await geocodeAddress(dropoff_address)

const driver = findNearestDriver(pickupCoords)

const ride = {
id: "ride_" + Date.now(),
rider_name,
rider_phone,
pickup_address,
dropoff_address,
pickup_coords: pickupCoords,
dropoff_coords: dropoffCoords,
status: driver ? "driver_assigned" : "searching",
driver_id: driver ? driver.id : null,
estimated_fare: (8 + Math.random() * 12).toFixed(2),
created: new Date()
}

if (driver) {
driver.available = false
}

rides.push(ride)

res.json({
success: true,
message: driver
? "Driver assigned automatically"
: "Searching for nearest driver",
ride,
assigned_driver: driver || null
})

})

/* ---------------------------
   GET RIDES
----------------------------*/

app.get('/api/rides', (req, res) => {
res.json(rides)
})

/* ---------------------------
   GET DRIVERS
----------------------------*/

app.get('/api/drivers', (req, res) => {
res.json(drivers)
})

app.listen(PORT, () => {
console.log("====================================")
console.log("Harvey Taxi Dispatch Brain Running")
console.log("====================================")
})
