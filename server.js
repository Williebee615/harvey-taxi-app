const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())

const DATA_FILE = path.join(__dirname, 'data.json')

if (!fs.existsSync(DATA_FILE)) {
fs.writeFileSync(DATA_FILE, JSON.stringify({
rides: [],
drivers: [],
riders: []
}, null, 2))
}

function readData(){
return JSON.parse(fs.readFileSync(DATA_FILE))
}

function writeData(data){
fs.writeFileSync(DATA_FILE, JSON.stringify(data,null,2))
}

function distanceMiles(lat1, lon1, lat2, lon2){
const R = 3958.8
const toRad = d => d*Math.PI/180

const dLat = toRad(lat2-lat1)
const dLon = toRad(lon2-lon1)

const a =
Math.sin(dLat/2)**2 +
Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*
Math.sin(dLon/2)**2

const c = 2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))
return R*c
}

app.use(express.static(path.join(__dirname,'public')))

app.get('/',(req,res)=>{
res.sendFile(path.join(__dirname,'public','index.html'))
})

/* DRIVER LOCATION UPDATE */
app.post('/api/driver-location',(req,res)=>{
const { driverId, lat, lng } = req.body

const data = readData()
const driver = data.drivers.find(d=>d.id===driverId)

if(!driver){
return res.json({success:false})
}

driver.location = {
lat:Number(lat),
lng:Number(lng),
updatedAt: new Date().toISOString()
}

driver.online = true

writeData(data)

res.json({success:true})
})

/* GET DRIVER LOCATION */
app.get('/api/driver-location/:id',(req,res)=>{
const data = readData()

const driver = data.drivers.find(d=>d.id===req.params.id)

if(!driver || !driver.location){
return res.json({success:false})
}

res.json({
success:true,
location:driver.location
})
})

/* DRIVER SIGNUP */
app.post('/api/driver-signup',(req,res)=>{
const data = readData()

const driver = {
id: Date.now().toString(),
name:req.body.name,
phone:req.body.phone,
vehicle:req.body.vehicle,
approved:true,
online:false,
location:null,
currentRide:null
}

data.drivers.push(driver)
writeData(data)

res.json({success:true})
})

/* RIDER SIGNUP */
app.post('/api/rider-signup',(req,res)=>{
const data = readData()

const rider = {
id: Date.now().toString(),
name:req.body.name,
phone:req.body.phone
}

data.riders.push(rider)
writeData(data)

res.json({success:true})
})

/* AUTO DISPATCH RIDE */
app.post('/api/request-ride',(req,res)=>{

const data = readData()

const ride = {
id: Date.now().toString(),
rider:req.body.rider,
phone:req.body.phone,
pickup:req.body.pickup,
dropoff:req.body.dropoff,
status:'requested',
driverId:null,
created:new Date().toISOString()
}

/* FIND NEAREST DRIVER */
let nearest = null
let bestDistance = 999999

if(ride.pickup && ride.pickup.includes(',')){

const [plat,plng] = ride.pickup.split(',').map(Number)

data.drivers.forEach(driver=>{

if(!driver.online) return
if(!driver.location) return
if(driver.currentRide) return

const d = distanceMiles(
plat,
plng,
driver.location.lat,
driver.location.lng
)

if(d < bestDistance){
bestDistance = d
nearest = driver
}

})

}

/* ASSIGN DRIVER */
if(nearest){
ride.driverId = nearest.id
ride.assignedDriverName = nearest.name
ride.status = 'assigned'

nearest.currentRide = ride.id
nearest.online = false
}

data.rides.push(ride)
writeData(data)

res.json({
success:true,
ride,
autoAssigned: !!nearest
})

})

/* GET RIDES */
app.get('/api/rides',(req,res)=>{
const data = readData()
res.json(data.rides)
})

/* DRIVER ACCEPT */
app.post('/api/driver-accept',(req,res)=>{
const { rideId, driverId } = req.body

const data = readData()

const ride = data.rides.find(r=>r.id===rideId)
const driver = data.drivers.find(d=>d.id===driverId)

if(!ride || !driver){
return res.json({success:false})
}

ride.status = 'enroute'
driver.currentRide = rideId

writeData(data)

res.json({success:true})
})

/* DRIVER COMPLETE */
app.post('/api/driver-complete',(req,res)=>{
const { rideId } = req.body

const data = readData()

const ride = data.rides.find(r=>r.id===rideId)

if(!ride){
return res.json({success:false})
}

ride.status='completed'

const driver = data.drivers.find(d=>d.id===ride.driverId)

if(driver){
driver.currentRide=null
driver.online=true
}

writeData(data)

res.json({success:true})
})

app.listen(PORT,()=>{
console.log("Server running on port",PORT)
})
