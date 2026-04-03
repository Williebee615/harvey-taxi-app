const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

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

app.get('/',(req,res)=>{
  res.sendFile(path.join(__dirname,'public','index.html'))
})

app.get('/api/status',(req,res)=>{
  res.json({status:'ok'})
})

app.post('/api/rider-signup',(req,res)=>{
  const riders = read('riders.json')

  const rider = {
    id:Date.now(),
    name:req.body.name || '',
    phone:req.body.phone || '',
    email:req.body.email || '',
    city:req.body.city || '',
    created:new Date()
  }

  riders.push(rider)
  write('riders.json',riders)

  res.json({success:true,rider})
})

app.post('/api/driver-signup',(req,res)=>{
  const drivers = read('drivers.json')

  const driver = {
    id:Date.now(),
    name:req.body.name || '',
    phone:req.body.phone || '',
    email:req.body.email || '',
    city:req.body.city || '',
    vehicle:req.body.vehicle || '',
    status:'active',
    online:true,
    created:new Date()
  }

  drivers.push(driver)
  write('drivers.json',drivers)

  res.json({success:true,driver})
})

app.post('/api/request-ride',(req,res)=>{
  const rides = read('rides.json')

  const ride = {
    id:Date.now(),
    rider:req.body.rider || '',
    riderPhone:req.body.riderPhone || '',
    pickup:req.body.pickup || '',
    dropoff:req.body.dropoff || '',
    status:'waiting',
    driverId:null,
    driverName:null,
    created:new Date()
  }

  rides.push(ride)
  write('rides.json',rides)

  res.json({success:true,ride})
})app.get('/api/rides',(req,res)=>{
  res.json(read('rides.json'))
})

app.get('/api/drivers',(req,res)=>{
  res.json(read('drivers.json'))
})

app.get('/api/available-rides',(req,res)=>{
  const rides = read('rides.json')
  const available = rides.filter(r=>r.status === 'waiting')
  res.json(available)
})

app.post('/api/rides/:id/accept',(req,res)=>{
  const rides = read('rides.json')
  const ride = rides.find(r=>String(r.id) === String(req.params.id))

  if(!ride){
    return res.status(404).json({success:false,error:'Ride not found'})
  }

  ride.status = 'accepted'
  ride.driverId = req.body.driverId || null
  ride.driverName = req.body.driverName || ''
  ride.acceptedAt = new Date()

  write('rides.json',rides)

  res.json({success:true,ride})
})

app.post('/api/rides/:id/status',(req,res)=>{
  const rides = read('rides.json')
  const ride = rides.find(r=>String(r.id) === String(req.params.id))

  if(!ride){
    return res.status(404).json({success:false,error:'Ride not found'})
  }

  ride.status = req.body.status || ride.status
  write('rides.json',rides)

  res.json({success:true,ride})
})

app.get('/:page',(req,res)=>{
  const filePath = path.join(__dirname,'public',req.params.page)

  if(fs.existsSync(filePath)){
    res.sendFile(filePath)
  }else{
    res.sendFile(path.join(__dirname,'public','index.html'))
  }
})

app.listen(PORT,()=>{
  console.log('Harvey Taxi UI + API running on port ' + PORT)
})
