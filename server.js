const express = require('express')
const cors = require('cors')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())

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

function distance(lat1,lng1,lat2,lng2){
const R = 3958.8
const dLat = (lat2-lat1) * Math.PI/180
const dLng = (lng2-lng1) * Math.PI/180

const a =
Math.sin(dLat/2)*Math.sin(dLat/2) +
Math.cos(lat1*Math.PI/180) *
Math.cos(lat2*Math.PI/180) *
Math.sin(dLng/2)*Math.sin(dLng/2)

const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))

return R*c
}

app.get('/',(req,res)=>{
res.send('Harvey Taxi Running')
})

app.get('/api/status',(req,res)=>{
res.json({status:'ok'})
})

/* DRIVER SIGNUP */
app.post('/api/driver-signup',(req,res)=>{

const drivers = read('drivers.json')

const driver = {
id:Date.now(),
name:req.body.name,
phone:req.body.phone,
vehicle:req.body.vehicle,
online:true,
lat:null,
lng:null
}

drivers.push(driver)

write('drivers.json',drivers)

res.json(driver)

})

/* DRIVER LOCATION (hidden) */
app.post('/api/driver-location',(req,res)=>{

const drivers = read('drivers.json')

const driver = drivers.find(d=>d.id==req.body.driverId)

if(!driver) return res.json({success:false})

driver.lat = req.body.lat
driver.lng = req.body.lng

write('drivers.json',drivers)

res.json({success:true})

})

/* REQUEST RIDE */
app.post('/api/request-ride',(req,res)=>{

const rides = read('rides.json')

const ride = {
id:Date.now(),
pickup:req.body.pickup,
dropoff:req.body.dropoff,
pickupLat:req.body.pickupLat,
pickupLng:req.body.pickupLng,
status:'waiting',
driverId:null,
driverName:null
}

rides.push(ride)

write('rides.json',rides)

res.json(ride)

})

/* AUTO ASSIGN */
app.post('/api/auto-assign/:id',(req,res)=>{

const rides = read('rides.json')
const drivers = read('drivers.json')

const ride = rides.find(r=>r.id==req.params.id)

const online = drivers.filter(d=>d.online && d.lat)

if(!online.length) return res.json({success:false})

let closest = null
let min = 999

online.forEach(d=>{

const dist = distance(
ride.pickupLat,
ride.pickupLng,
d.lat,
d.lng
)

if(dist < min){
min = dist
closest = d
}

})

ride.driverId = closest.id
ride.driverName = closest.name
ride.status = "assigned"

write('rides.json',rides)

res.json(closest)

})

/* GET RIDES (no GPS shown) */
app.get('/api/rides',(req,res)=>{

const rides = read('rides.json')

const safe = rides.map(r=>({
id:r.id,
pickup:r.pickup,
dropoff:r.dropoff,
driverName:r.driverName,
status:r.status
}))

res.json(safe)

})

app.listen(PORT,()=>{
console.log('HARVEY TAXI LIVE')
})
