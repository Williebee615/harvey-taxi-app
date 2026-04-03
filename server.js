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

/* -------------------------
   FILE HELPERS
--------------------------*/

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

/* -------------------------
   STATUS
--------------------------*/

app.get('/api/status',(req,res)=>{
  res.json({
    status:"Harvey Taxi Running",
    time:new Date()
  })
})

/* -------------------------
   REQUEST RIDE
--------------------------*/

app.post('/api/request-ride',(req,res)=>{

  let rides = read('rides.json')

  const ride = {
    id: Date.now(),
    pickup: req.body.pickup,
    dropoff: req.body.dropoff,
    rider: req.body.rider,
    status:"waiting",
    driverId:null,
    driverName:null,
    acceptedAt:null,
    created:new Date()
  }

  rides.push(ride)
  write('rides.json', rides)

  res.json({
    success:true,
    ride
  })

})

/* -------------------------
   GET ALL RIDES
--------------------------*/

app.get('/api/rides',(req,res)=>{
  res.json(read('rides.json'))
})

/* -------------------------
   AVAILABLE RIDES
--------------------------*/

app.get('/api/available-rides',(req,res)=>{

  let rides = read('rides.json')

  const available = rides.filter(r=> r.status === "waiting")

  res.json(available)

})

/* -------------------------
   ACCEPT RIDE (DRIVER)
--------------------------*/

app.post('/api/rides/:id/accept',(req,res)=>{

  let rides = read('rides.json')

  const ride = rides.find(r => r.id == req.params.id)

  if(!ride){
    return res.json({error:"Ride not found"})
  }

  ride.status = "accepted"
  ride.driverId = req.body.driverId
  ride.driverName = req.body.driverName
  ride.acceptedAt = new Date()

  write('rides.json', rides)

  res.json({
    success:true,
    ride
  })

})

/* -------------------------
   UPDATE RIDE STATUS
--------------------------*/

app.post('/api/rides/:id/status',(req,res)=>{

  let rides = read('rides.json')

  const ride = rides.find(r => r.id == req.params.id)

  if(!ride){
    return res.json({error:"Ride not found"})
  }

  ride.status = req.body.status

  write('rides.json', rides)

  res.json({
    success:true,
    ride
  })

})

/* -------------------------
   DRIVER SIGNUP
--------------------------*/

app.post('/api/driver-signup',(req,res)=>{

  let drivers = read('drivers.json')

  const driver = {
    id: Date.now(),
    name: req.body.name,
    phone: req.body.phone,
    vehicle: req.body.vehicle,
    status:"active",
    created:new Date()
  }

  drivers.push(driver)

  write('drivers.json', drivers)

  res.json({
    success:true,
    driver
  })

})

/* -------------------------
   RIDER SIGNUP
--------------------------*/

app.post('/api/rider-signup',(req,res)=>{

  let riders = read('riders.json')

  const rider = {
    id: Date.now(),
    name:req.body.name,
    phone:req.body.phone,
    created:new Date()
  }

  riders.push(rider)

  write('riders.json', riders)

  res.json({
    success:true,
    rider
  })

})

app.listen(PORT, () => {
  console.log("===================================")
  console.log("Harvey Taxi Dispatch Running")
  console.log("===================================")
})
