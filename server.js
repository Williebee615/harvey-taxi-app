const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// storage
let rides = []
let drivers = []

// fare settings
const fareSettings = {
baseFare: 3.5,
perMile: 1.85,
perMinute: 0.32,
minimumFare: 8,
bookingFee: 2.25,
serviceFeeRate: 0.08
}

function calculateFare(distance, minutes) {

const base = fareSettings.baseFare
const distanceFare = distance * fareSettings.perMile
const timeFare = minutes * fareSettings.perMinute

const subtotal = base + distanceFare + timeFare
const serviceFee = subtotal * fareSettings.serviceFeeRate

let total =
subtotal +
serviceFee +
fareSettings.bookingFee

if (total < fareSettings.minimumFare) {
total = fareSettings.minimumFare
}

return {
baseFare: base.toFixed(2),
distanceFare: distanceFare.toFixed(2),
timeFare: timeFare.toFixed(2),
bookingFee: fareSettings.bookingFee.toFixed(2),
serviceFee: serviceFee.toFixed(2),
totalFare: total.toFixed(2)
}

}

function estimateTrip(pickup, dropoff) {

const length =
pickup.length +
dropoff.length

const distance =
Math.max(3, Math.min(15, length / 5))

const minutes =
Math.round(distance * 2.5)

return {
distanceMiles: distance.toFixed(1),
durationMinutes: minutes
}

}

// estimate
app.post('/api/fare/estimate', (req,res)=>{

const { pickupAddress, dropoffAddress } = req.body

if(!pickupAddress || !dropoffAddress){
return res.json({
success:false,
message:'missing address'
})
}

const trip =
estimateTrip(
pickupAddress,
dropoffAddress
)

const fare =
calculateFare(
trip.distanceMiles,
trip.durationMinutes
)

res.json({
success:true,
trip,
fare
})

})

// request ride
app.post('/api/rides/request',(req,res)=>{

const {
pickupAddress,
dropoffAddress,
serviceType
} = req.body

const trip =
estimateTrip(
pickupAddress,
dropoffAddress
)

const fare =
calculateFare(
trip.distanceMiles,
trip.durationMinutes
)

const ride = {
id: Date.now(),
pickupAddress,
dropoffAddress,
serviceType,
trip,
fare,
status:'searching'
}

rides.push(ride)

res.json({
success:true,
ride
})

})

app.get('/api/rides',(req,res)=>{
res.json(rides)
})

app.listen(PORT,()=>{
console.log("Harvey Taxi running on port",PORT)
})
