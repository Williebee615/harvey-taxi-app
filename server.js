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
const MESSAGES = './messages.json'

function read(file){
try{
return JSON.parse(fs.readFileSync(file,'utf8'))
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

/* ================================
   STATUS
================================ */

app.get('/api/status',(req,res)=>{
res.json({
success:true,
system:'Harvey Taxi AV Ready',
dispatch:'auto',
time:new Date()
})
})

/* ================================
   RIDER SIGNUP
================================ */

app.post('/api/rider-signup',(req,res)=>{

const riders = read(RIDERS)

const rider = {
id: uid(),
name:req.body.name,
phone:req.body.phone,
email:req.body.email,
created:new Date()
}

riders.push(rider)
write(RIDERS,riders)

res.json({success:true,rider})

})

/* ================================
   VEHICLE REGISTER (Driver or AV)
================================ */

app.post('/api/vehicle/register',(req,res)=>{

const vehicles = read(VEHICLES)

const vehicle = {

id: uid(),

type: req.body.type || "human", // human or autonomous

name:req.body.name || "vehicle",

vehicle:req.body.vehicle || "",

plate:req.body.plate || "",

status:"online",

available:true,

created:new Date()

}

vehicles.push(vehicle)
write(VEHICLES,vehicles)

res.json({success:true,vehicle})

})

/* ================================
   GET VEHICLES
================================ */

app.get('/api/vehicles',(req,res)=>{
res.json(read(VEHICLES))
})

/* ================================
   REQUEST RIDE
================================ */

app.post('/api/request-ride',(req,res)=>{

const rides = read(RIDES)

const ride = {

id: uid(),

rider:req.body.name,

phone:req.body.phone,

pickup:req.body.pickup,

dropoff:req.body.dropoff,

status:"searching",

vehicle:null,

created:new Date()

}

rides.push(ride)

write(RIDES,rides)

/* AUTO DISPATCH */
autoDispatch()

res.json({
success:true,
ride
})

})

/* ================================
   AUTO DISPATCH ENGINE
================================ */

function autoDispatch(){

const rides = read(RIDES)
const vehicles = read(VEHICLES)

const waitingRide = rides.find(r=>r.status==="searching")

if(!waitingRide) return

const vehicle = vehicles.find(v=>v.available === true)

if(!vehicle) return

waitingRide.status = "assigned"
waitingRide.vehicle = vehicle.id

vehicle.available = false

write(RIDES,rides)
write(VEHICLES,vehicles)

}

/* ================================
   GET RIDES
================================ */

app.get('/api/rides',(req,res)=>{
res.json(read(RIDES))
})

/* ================================
   UPDATE RIDE STATUS
================================ */

app.post('/api/rides/:id/status',(req,res)=>{

const rides = read(RIDES)
const vehicles = read(VEHICLES)

const ride = rides.find(r=>r.id === req.params.id)

if(!ride) return res.json({success:false})

ride.status = req.body.status

/* release vehicle when completed */

if(req.body.status === "completed"){

const vehicle = vehicles.find(v=>v.id === ride.vehicle)

if(vehicle){
vehicle.available = true
}

}

write(RIDES,rides)
write(VEHICLES,vehicles)

res.json({success:true})

})

/* ================================
   MESSAGING SYSTEM
================================ */

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

/* ================================
   ADMIN LOGIN
================================ */

app.post('/api/admin-login',(req,res)=>{

if(
req.body.email === "admin@harvey.com" &&
req.body.password === "admin123"
){
return res.json({success:true})
}

res.json({success:false})

})

/* ================================
   PAGE ROUTING
================================ */

app.get('/:page',(req,res)=>{

const file = path.join(__dirname,'public',req.params.page)

if(fs.existsSync(file)){
res.sendFile(file)
}else{
res.sendFile(path.join(__dirname,'public/index.html'))
}

})

app.listen(PORT,()=>{
console.log("Harvey Taxi AV System Running")
})
