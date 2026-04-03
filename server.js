const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const RIDES = './rides.json'
const VEHICLES = './vehicles.json'
const RIDERS = './riders.json'

function read(file){
try{
return JSON.parse(fs.readFileSync(file))
}catch{
return []
}
}

function write(file,data){
fs.writeFileSync(file, JSON.stringify(data,null,2))
}

function uid(){
return Math.random().toString(36).substring(2,9)
}

function distance(a,b,c,d){
const R = 3958.8
const dLat = (c-a) * Math.PI/180
const dLon = (d-b) * Math.PI/180

const lat1 = a * Math.PI/180
const lat2 = c * Math.PI/180

const x =
Math.sin(dLat/2) * Math.sin(dLat/2) +
Math.sin(dLon/2) * Math.sin(dLon/2) *
Math.cos(lat1) * Math.cos(lat2)

return R * (2 * Math.atan2(Math.sqrt(x),Math.sqrt(1-x)))
}

/* ---------------------------
CREATE VEHICLE
----------------------------*/

app.post('/api/vehicle/register',(req,res)=>{

const vehicles = read(VEHICLES)

const vehicle = {
id: uid(),
type: req.body.type || "human",
name: req.body.name,
vehicleName: req.body.vehicleName,
online: false,
status:"idle",

lat:0,
lng:0,

battery:100,
autonomous: req.body.type === "autonomous",

created: Date.now()
}

vehicles.push(vehicle)
write(VEHICLES,vehicles)

res.json(vehicle)

})

/* ---------------------------
VEHICLE ONLINE
----------------------------*/

app.post('/api/vehicle/online',(req,res)=>{

const vehicles = read(VEHICLES)

const v = vehicles.find(x=>x.id===req.body.id)

if(!v) return res.sendStatus(404)

v.online = true
v.status = "idle"

write(VEHICLES,vehicles)

res.json(v)

})

/* ---------------------------
VEHICLE LOCATION (HIDDEN)
----------------------------*/

app.post('/api/vehicle/location',(req,res)=>{

const vehicles = read(VEHICLES)

const v = vehicles.find(x=>x.id===req.body.id)

if(!v) return res.sendStatus(404)

v.lat = req.body.lat
v.lng = req.body.lng

write(VEHICLES,vehicles)

res.json({success:true})

})

/* ---------------------------
REQUEST RIDE
----------------------------*/

app.post('/api/request-ride',(req,res)=>{

const rides = read(RIDES)

const ride = {
id: uid(),

riderName:req.body.name,
pickup:req.body.pickup,
dropoff:req.body.dropoff,

pickupLat:req.body.pickupLat,
pickupLng:req.body.pickupLng,

status:"searching",
vehicleId:null,
vehicleName:null,

created: Date.now()
}

rides.push(ride)
write(RIDES,rides)

autoDispatch(ride.id)

res.json(ride)

})

/* ---------------------------
AUTO DISPATCH
----------------------------*/

function autoDispatch(rideId){

const rides = read(RIDES)
const vehicles = read(VEHICLES)

const ride = rides.find(r=>r.id===rideId)
if(!ride) return

const available = vehicles.filter(v=>v.online && v.status==="idle")

if(!available.length) return

let best = null
let bestDist = 999999

available.forEach(v=>{

const d = distance(
ride.pickupLat,
ride.pickupLng,
v.lat,
v.lng
)

if(d < bestDist){
bestDist = d
best = v
}

})

if(!best) return

ride.vehicleId = best.id
ride.vehicleName = best.vehicleName || best.name
ride.status = "assigned"

best.status = "enroute"

write(RIDES,rides)
write(VEHICLES,vehicles)

}/* ---------------------------
VEHICLE ARRIVED
----------------------------*/

app.post('/api/vehicle/arrived',(req,res)=>{

const rides = read(RIDES)

const ride = rides.find(r=>r.vehicleId===req.body.id)

if(!ride) return res.sendStatus(404)

ride.status = "arrived"

write(RIDES,rides)

res.json(ride)

})

/* ---------------------------
START TRIP
----------------------------*/

app.post('/api/trip/start',(req,res)=>{

const rides = read(RIDES)

const ride = rides.find(r=>r.vehicleId===req.body.id)

if(!ride) return res.sendStatus(404)

ride.status = "in_progress"

write(RIDES,rides)

res.json(ride)

})

/* ---------------------------
COMPLETE TRIP
----------------------------*/

app.post('/api/trip/complete',(req,res)=>{

const rides = read(RIDES)
const vehicles = read(VEHICLES)

const ride = rides.find(r=>r.vehicleId===req.body.id)
const vehicle = vehicles.find(v=>v.id===req.body.id)

if(!ride) return res.sendStatus(404)

ride.status = "completed"

if(vehicle){
vehicle.status = "idle"
}

write(RIDES,rides)
write(VEHICLES,vehicles)

res.json({success:true})

})

/* ---------------------------
ADMIN RIDES (NO GPS)
----------------------------*/

app.get('/api/rides',(req,res)=>{

const rides = read(RIDES)

const safe = rides.map(r=>({

id:r.id,
riderName:r.riderName,
pickup:r.pickup,
dropoff:r.dropoff,
status:r.status,
vehicleName:r.vehicleName

}))

res.json(safe)

})

/* ---------------------------
ADMIN VEHICLES (NO GPS)
----------------------------*/

app.get('/api/vehicles',(req,res)=>{

const vehicles = read(VEHICLES)

const safe = vehicles.map(v=>({

id:v.id,
name:v.name,
vehicleName:v.vehicleName,
type:v.type,
status:v.status,
online:v.online,
battery:v.battery

}))

res.json(safe)

})

app.listen(PORT,()=>{
console.log("AV SYSTEM LIVE")
})const MESSAGES = './messages.json'

app.post('/api/send-message', (req,res)=>{

const messages = read(MESSAGES)

const message = {
id: uid(),
rideId: req.body.rideId,
from: req.body.from,
to: req.body.to,
text: req.body.text,
time: Date.now()
}

messages.push(message)
write(MESSAGES,messages)

res.json({success:true})

})

app.get('/api/messages/:rideId',(req,res)=>{

const messages = read(MESSAGES)

const filtered = messages.filter(
m => m.rideId === req.params.rideId
)

res.json(filtered)

})
