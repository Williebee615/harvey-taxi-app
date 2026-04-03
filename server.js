const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname,'public')))

const RIDES = './rides.json'
const VEHICLES = './vehicles.json'
const RIDERS = './riders.json'
const MESSAGES = './messages.json'
const MISSIONS = './missions.json'

function read(file){
try{
return JSON.parse(fs.readFileSync(file,'utf8'))
}catch{
return []
}
}

function write(file,data){
fs.writeFileSync(file,JSON.stringify(data,null,2))
}

function uid(){
return Math.random().toString(36).substring(2,9)
}

/* ===============================
STATUS
=============================== */

app.get('/api/status',(req,res)=>{
res.json({
system:"Harvey Taxi Fleet Intelligence",
autonomous:true,
dispatch:"smart",
time:new Date()
})
})

/* ===============================
RIDER SIGNUP
=============================== */

app.post('/api/rider-signup',(req,res)=>{

const riders = read(RIDERS)

const rider = {
id:uid(),
name:req.body.name,
phone:req.body.phone,
email:req.body.email,
created:new Date()
}

riders.push(rider)
write(RIDERS,riders)

res.json({success:true,rider})

})

/* ===============================
VEHICLE REGISTER
=============================== */

app.post('/api/vehicle/register',(req,res)=>{

const vehicles = read(VEHICLES)

const vehicle = {

id:uid(),

type:req.body.type || "human",

name:req.body.name || "vehicle",

vehicle:req.body.vehicle || "",

plate:req.body.plate || "",

zone:req.body.zone || "default",

battery:req.body.battery || 100,

status:"online",

available:true,

remoteAssist:false,

created:new Date()

}

vehicles.push(vehicle)
write(VEHICLES,vehicles)

res.json({success:true,vehicle})

})

/* ===============================
GET VEHICLES
=============================== */

app.get('/api/vehicles',(req,res)=>{
res.json(read(VEHICLES))
})

/* ===============================
UPDATE VEHICLE STATUS
=============================== */

app.post('/api/vehicle/:id/status',(req,res)=>{

const vehicles = read(VEHICLES)

const vehicle = vehicles.find(v=>v.id === req.params.id)

if(!vehicle) return res.json({success:false})

vehicle.status = req.body.status

write(VEHICLES,vehicles)

res.json({success:true})

})

/* ===============================
UPDATE BATTERY
=============================== */

app.post('/api/vehicle/:id/battery',(req,res)=>{

const vehicles = read(VEHICLES)

const vehicle = vehicles.find(v=>v.id === req.params.id)

if(!vehicle) return res.json({success:false})

vehicle.battery = req.body.battery

write(VEHICLES,vehicles)

res.json({success:true})

})

/* ===============================
REQUEST RIDE
=============================== */

app.post('/api/request-ride',(req,res)=>{

const rides = read(RIDES)

const ride = {

id:uid(),

rider:req.body.name,

phone:req.body.phone,

pickup:req.body.pickup,

dropoff:req.body.dropoff,

zone:req.body.zone || "default",

status:"searching",

vehicle:null,

mission:null,

created:new Date()

}

rides.push(ride)

write(RIDES,rides)

smartDispatch()

res.json({
success:true,
ride
})

})

/* ===============================
SMART DISPATCH ENGINE
=============================== */

function smartDispatch(){

const rides = read(RIDES)
const vehicles = read(VEHICLES)
const missions = read(MISSIONS)

const ride = rides.find(r=>r.status === "searching")

if(!ride) return

/* priority:
1 same zone
2 available
3 online
4 battery > 25
*/

const vehicle = vehicles.find(v =>
v.available === true &&
v.status === "online" &&
v.zone === ride.zone &&
v.battery > 25
)

if(!vehicle) return

vehicle.available = false

ride.vehicle = vehicle.id
ride.status = "assigned"

/* create mission */

const mission = {
id:uid(),
rideId:ride.id,
vehicleId:vehicle.id,
status:"queued",
pickup:ride.pickup,
dropoff:ride.dropoff,
created:new Date()
}

missions.push(mission)

ride.mission = mission.id

write(RIDES,rides)
write(VEHICLES,vehicles)
write(MISSIONS,missions)

}

/* ===============================
GET RIDES
=============================== */

app.get('/api/rides',(req,res)=>{
res.json(read(RIDES))
})

/* ===============================
GET MISSIONS
=============================== */

app.get('/api/missions',(req,res)=>{
res.json(read(MISSIONS))
})

/* ===============================
MISSION STATUS
=============================== */

app.post('/api/mission/:id/status',(req,res)=>{

const missions = read(MISSIONS)
const mission = missions.find(m=>m.id === req.params.id)

if(!mission) return res.json({success:false})

mission.status = req.body.status

write(MISSIONS,missions)

res.json({success:true})

})

/* ===============================
COMPLETE RIDE
=============================== */

app.post('/api/rides/:id/complete',(req,res)=>{

const rides = read(RIDES)
const vehicles = read(VEHICLES)

const ride = rides.find(r=>r.id === req.params.id)

if(!ride) return res.json({success:false})

ride.status = "completed"

const vehicle = vehicles.find(v=>v.id === ride.vehicle)

if(vehicle){
vehicle.available = true
}

write(RIDES,rides)
write(VEHICLES,vehicles)

res.json({success:true})

})

/* ===============================
MESSAGING
=============================== */

app.post('/api/send-message',(req,res)=>{

const messages = read(MESSAGES)

const message = {

id:uid(),

rideId:req.body.rideId || "support",

from:req.body.from,

to:req.body.to,

text:req.body.text,

time:new Date()

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

/* ===============================
ADMIN LOGIN
=============================== */

app.post('/api/admin-login',(req,res)=>{

if(
req.body.email === "admin@harvey.com" &&
req.body.password === "admin123"
){
return res.json({success:true})
}

res.json({success:false})

})

/* ===============================
PAGE ROUTER
=============================== */

app.get('/:page',(req,res)=>{

const file = path.join(__dirname,'public',req.params.page)

if(fs.existsSync(file)){
res.sendFile(file)
}else{
res.sendFile(path.join(__dirname,'public/index.html'))
}

})

app.listen(PORT,()=>{
console.log("Harvey Taxi Fleet Intelligence Running")
})
