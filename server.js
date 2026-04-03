const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const axios = require('axios')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())

// serve public folder
app.use(express.static(path.join(__dirname, 'public')))

// root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'))
})

// dynamic fallback for all html pages
app.get('/:page', (req, res) => {
  const file = path.join(__dirname, 'public', req.params.page)

  if (fs.existsSync(file)) {
    res.sendFile(file)
  } else {
    res.sendFile(path.join(__dirname, 'public/index.html'))
  }
})

/* -------------------------
   API ROUTES
--------------------------*/

// health check
app.get('/api/status', (req,res)=>{
  res.json({
    status:"Harvey Taxi API Running",
    time:new Date()
  })
})

// request ride
app.post('/api/request-ride',(req,res)=>{

  const ride = {
    id: Date.now(),
    pickup: req.body.pickup,
    dropoff: req.body.dropoff,
    rider: req.body.rider,
    status:"waiting",
    created:new Date()
  }

  let rides = []

  try{
    rides = JSON.parse(fs.readFileSync('rides.json'))
  }catch{
    rides = []
  }

  rides.push(ride)

  fs.writeFileSync('rides.json', JSON.stringify(rides,null,2))

  res.json({
    success:true,
    ride
  })
})


// get rides
app.get('/api/rides',(req,res)=>{

  let rides = []

  try{
    rides = JSON.parse(fs.readFileSync('rides.json'))
  }catch{
    rides=[]
  }

  res.json(rides)
})


// driver signup
app.post('/api/driver-signup',(req,res)=>{

  const driver = {
    id:Date.now(),
    name:req.body.name,
    phone:req.body.phone,
    vehicle:req.body.vehicle,
    status:"pending"
  }

  let drivers=[]

  try{
    drivers=JSON.parse(fs.readFileSync('drivers.json'))
  }catch{
    drivers=[]
  }

  drivers.push(driver)

  fs.writeFileSync('drivers.json', JSON.stringify(drivers,null,2))

  res.json({
    success:true,
    driver
  })

})


// rider signup
app.post('/api/rider-signup',(req,res)=>{

  const rider = {
    id:Date.now(),
    name:req.body.name,
    phone:req.body.phone,
    created:new Date()
  }

  let riders=[]

  try{
    riders=JSON.parse(fs.readFileSync('riders.json'))
  }catch{
    riders=[]
  }

  riders.push(rider)

  fs.writeFileSync('riders.json', JSON.stringify(riders,null,2))

  res.json({
    success:true,
    rider
  })

})

app.listen(PORT, () => {
  console.log("===================================")
  console.log("Harvey Taxi Server Running")
  console.log("===================================")
  console.log(`Available at your primary URL`)
})
