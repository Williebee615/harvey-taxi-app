app.post('/api/vehicle/:id/resume',(req,res)=>{

const vehicles = read(VEHICLES)

const vehicle = vehicles.find(
v => v.id === req.params.id
)

if(!vehicle) return res.json({success:false})

vehicle.remoteAssist = false
vehicle.status = "online"

write(VEHICLES,vehicles)

res.json({success:true})

})app.post('/api/vehicle/:id/remote-assist',(req,res)=>{

const vehicles = read(VEHICLES)

const vehicle = vehicles.find(
v => v.id === req.params.id
)

if(!vehicle) return res.json({success:false})

vehicle.remoteAssist = true

write(VEHICLES,vehicles)

res.json({success:true})

})app.post('/api/vehicle/:id/return-base',(req,res)=>{

const vehicles = read(VEHICLES)

const vehicle = vehicles.find(
v => v.id === req.params.id
)

if(!vehicle) return res.json({success:false})

vehicle.status = "returning"

write(VEHICLES,vehicles)

res.json({success:true})

})app.post('/api/vehicle/:id/emergency-stop',(req,res)=>{

const vehicles = read(VEHICLES)

const vehicle = vehicles.find(
v => v.id === req.params.id
)

if(!vehicle) return res.json({success:false})

vehicle.status = "emergency_stop"
vehicle.available = false

write(VEHICLES,vehicles)

res.json({success:true})

})app.post('/api/command/:id/status',(req,res)=>{

const commands = read(COMMANDS)

const command = commands.find(
c => c.id === req.params.id
)

if(!command) return res.json({success:false})

command.status = req.body.status

write(COMMANDS,commands)

res.json({success:true})

})app.get('/api/vehicle/:id/commands',(req,res)=>{

const commands = read(COMMANDS)

const filtered = commands.filter(
c => c.vehicleId === req.params.id
)

res.json(filtered)

})/* ===============================
SEND VEHICLE COMMAND
=============================== */

app.post('/api/vehicle/:id/command',(req,res)=>{

const commands = read(COMMANDS)

const command = {

id:uid(),

vehicleId:req.params.id,

type:req.body.type,

data:req.body.data || {},

status:"queued",

created:new Date()

}

commands.push(command)

write(COMMANDS,commands)

res.json({success:true,command})

})const COMMANDS = './commands.json'const express = require('express')
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
const MISSIONS = './missions.json'

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return []
  }
}

function write(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

function uid() {
  return Math.random().toString(36).substring(2, 10)
}

function newTimeline(event, note = '') {
  return {
    time: new Date().toISOString(),
    event,
    note
  }
}

/* STATUS */
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    system: 'Harvey Taxi AV Control System',
    control: 'live',
    time: new Date().toISOString()
  })
})

/* RIDER SIGNUP */
app.post('/api/rider-signup', (req, res) => {
  const riders = read(RIDERS)

  const rider = {
    id: uid(),
    name: req.body.name || '',
    phone: req.body.phone || '',
    email: req.body.email || '',
    createdAt: new Date().toISOString()
  }

  riders.push(rider)
  write(RIDERS, riders)

  res.json({ success: true, rider })
})

/* VEHICLE REGISTER */
app.post('/api/vehicle/register', (req, res) => {
  const vehicles = read(VEHICLES)

  const vehicle = {
    id: uid(),
    type: req.body.type || 'human', // human or autonomous
    name: req.body.name || 'vehicle',
    vehicle: req.body.vehicle || '',
    plate: req.body.plate || '',
    zone: req.body.zone || 'default',
    battery: Number(req.body.battery || 100),
    status: 'online',
