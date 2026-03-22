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
id:'driver_1',
name:'Marcus Johnson',
vehicle:'Toyota Camry',
plate:'HTX-101',
online:true,
lat:36.1627,
lng:-86.7816
},
{
id:'driver_2',
name:'Alicia Brown',
vehicle:'Honda Accord',
plate:'HTX-202',
online:true,
lat:36.1745,
lng:-86.7679
}
]

const fareSettings = {
Standard:{base:3.5,mile:1.8,minute:.32,booking:2.25},
XL:{base:5.5,mile:2.6,minute:.45,booking:2.75},
Luxury:{base:8,mile:3.75,minute:.65,booking:3.5}
}

function distance(a,b,c,d){
const R=3958.8
const dLat=(c-a)*Math.PI/180
const dLng=(d-b)*Math.PI/180

const x=
Math.sin(dLat/2)*Math.sin(dLat/2)+
Math.cos(a*Math.PI/180)*
Math.cos(c*Math.PI/180)*
Math.sin(dLng/2)*Math.sin(dLng/2)

return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))
}

function calculateFare(miles,minutes,type){

const s=fareSettings[type]||fareSettings.Standard

const base=s.base
const dist=miles*s.mile
const time=minutes*s.minute
const booking=s.booking

const total=base+dist+time+booking

return{
base:base.toFixed(2),
distanceCharge:dist.toFixed(2),
timeCharge:time.toFixed(2),
booking:booking.toFixed(2),
service:"0.00",
total:total.toFixed(2)
}

}

/* estimate */
app.post('/estimate-fare',(req,res)=>{

const miles=Number(req.body.distance)||8
const minutes=Number(req.body.duration)||18
const type=req.body.rideType||"Standard"

res.json({
success:true,
distance:miles,
duration:minutes,
fare:calculateFare(miles,minutes,type)
})

})

/* request ride */
app.post('/request-ride',(req,res)=>{

try{

const pickup=req.body.pickup||"Pickup"
const dropoff=req.body.dropoff||"Dropoff"

const miles=Number(req.body.distance)||8
const minutes=Number(req.body.duration)||18
const type=req.body.rideType||"Standard"

const pickupLat=Number(req.body.pickupLat)||36.1627
const pickupLng=Number(req.body.pickupLng)||-86.7816

let closest=null
let closestDist=999

drivers.forEach(d=>{

if(!d.online) return

const dist=distance(pickupLat,pickupLng,d.lat,d.lng)

if(dist<closestDist){
closestDist=dist
closest=d
}

})

if(!closest){
return res.json({
success:false,
message:"No drivers available"
})
}

closest.online=false

const ride={
id:"ride_"+Date.now(),
pickup,
dropoff,
rideType:type,
distance:miles,
duration:minutes,
fare:calculateFare(miles,minutes,type),
driver:{
name:closest.name,
vehicle:closest.vehicle,
plate:closest.plate,
distanceAway:closestDist.toFixed(1),
etaMinutes:Math.round((closestDist/.4)+2)
}
}

rides.push(ride)

res.json({
success:true,
ride
})

}catch(e){

console.log(e)

res.json({
success:false,
message:"Server error while requesting ride."
})

}

})

app.listen(PORT,()=>console.log("Harvey Taxi running"))
