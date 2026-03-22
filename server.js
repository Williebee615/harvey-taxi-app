const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

let rides = []

let drivers = [
{
id: 'driver_1',
name: 'Marcus Johnson',
phone: '615-555-0101',
vehicle: 'Toyota Camry',
plate: 'HTX-101',
approved: true,
online: true,
lat: 36.1627,
lng: -86.7816
},
{
id: 'driver_2',
name: 'Alicia Brown',
phone: '615-555-0102',
vehicle: 'Honda Accord',
plate: 'HTX-202',
approved: true,
online: true,
lat: 36.1745,
lng: -86.7679
},
{
id: 'driver_3',
name: 'David Carter',
phone: '615-555-0103',
vehicle: 'Nissan Altima',
plate: 'HTX-303',
approved: true,
online: true,
lat: 36.1570,
lng: -86.8040
}
]

const fareSettings = {
Standard:{
baseFare:3.5,
perMile:1.85,
perMinute:0.32,
bookingFee:2.25,
serviceRate:0.07,
minimumFare:8.5
},
XL:{
baseFare:5.5,
perMile:2.6,
perMinute:0.45,
bookingFee:2.75,
serviceRate:0.08,
minimumFare:12
},
Luxury:{
baseFare:8,
perMile:3.75,
perMinute:0.65,
bookingFee:3.5,
serviceRate:0.1,
minimumFare:18
}
}

function getDistance(lat1,lng1,lat2,lng2){
const R = 3958.8
const dLat = (lat2-lat1)*Math.PI/180
const dLng = (lng2-lng1)*Math.PI/180

const a =
Math.sin(dLat/2)*Math.sin(dLat/2)+
Math.cos(lat1*Math.PI/180)*
Math.cos(lat2*Math.PI/180)*
Math.sin(dLng/2)*
Math.sin(dLng/2)

const c = 2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))
return R*c
}

function calculateFare(distance,duration,type="Standard"){

const s = fareSettings[type]

const base = s.baseFare
const distanceCharge = distance * s.perMile
const timeCharge = duration * s.perMinute
const booking = s.bookingFee

const subtotal = base + distanceCharge + timeCharge + booking
const service = subtotal * s.serviceRate

let total = subtotal + service

if(total < s.minimumFare){
total = s.minimumFare
}

return {
base:base.toFixed(2),
distanceCharge:distanceCharge.toFixed(2),
timeCharge:timeCharge.toFixed(2),
booking:booking.toFixed(2),
service:service.toFixed(2),
total:total.toFixed(2)
}

}

/* estimate fare */
app.post('/estimate-fare',(req,res)=>{

const {distance,duration,rideType} = req.body

const fare = calculateFare(
Number(distance)||8,
Number(duration)||18,
rideType || "Standard"
)

res.json({
success:true,
distance:Number(distance)||8,
duration:Number(duration)||18,
fare
})

})

/* request ride */
app.post('/request-ride',(req,res)=>{

try{

const {
pickup,
dropoff,
pickupLat,
pickupLng,
distance,
duration,
rideType,
fare
} = req.body

const miles = Number(distance)||8
const minutes = Number(duration)||18
const type = rideType || "Standard"

const finalFare = fare && fare.total
? fare
: calculateFare(miles,minutes,type)

let closestDriver = null
let closestDistance = Infinity

drivers.forEach(driver=>{

if(!driver.online) return

const d = getDistance(
Number(pickupLat)||36.1627,
Number(pickupLng)||-86.7816,
driver.lat,
driver.lng
)

if(d < closestDistance){
closestDistance = d
closestDriver = driver
}

})

if(!closestDriver){
return res.json({
success:false,
message:"No drivers available"
})
}

closestDriver.online = false

const ride = {
id:"ride_"+Date.now(),
pickup,
dropoff,
distance:miles,
duration:minutes,
rideType:type,
fare:finalFare,
status:"matched",
driver:{
name:closestDriver.name,
vehicle:closestDriver.vehicle,
plate:closestDriver.plate,
distanceAway:closestDistance.toFixed(1),
etaMinutes:Math.round((closestDistance/0.4)+2)
}
}

rides.push(ride)

res.json({
success:true,
ride
})

}catch(err){

console.log(err)

res.json({
success:false,
message:"Server error while requesting ride."
})

}

})

app.get('/rides',(req,res)=>{
res.json(rides)
})

app.listen(PORT,()=>{
console.log("Harvey Taxi running on port "+PORT)
})
