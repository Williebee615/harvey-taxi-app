const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const RIDERS = './riders.json'
const RIDES = './rides.json'
const VEHICLES = './vehicles.json'
const MESSAGES = './messages.json'
const MISSIONS = './missions.json'
const COMMANDS = './commands.json'

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    return []
  }
}

function write(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function timelineEntry(event, note = '') {
  return {
    time: new Date().toISOString(),
    event,
    note
  }
}

/* HOME */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

/* STATUS */
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    system: 'Harvey Taxi AV Control System',
    time: new Date().toISOString()
  })
})

/* ADMIN LOGIN */
app.post('/api/admin-login', (req, res) => {
  const email = req.body.email || ''
  const password = req.body.password || ''

  if (email === 'admin@harveytaxi.com' && password === 'admin123') {
    return res.json({
      success: true,
      user: {
        email: 'admin@harveytaxi.com',
        role: 'admin'
      }
    })
  }

  return res.status(401).json({
    success: false,
    message: 'Invalid login'
  })
})

/* RIDER SIGNUP */
app.post('/api/rider-signup', (req, res) => {
  const riders = read(RIDERS)

  const rider = {
    id: uid(),
    name: req.body.name || '',
    email: req.body.email || '',
    phone: req.body.phone || '',
    city: req.body.city || '',
    createdAt: new Date().toISOString()
  }

  riders.push(rider)
  write(RIDERS, riders)

  res.json({
    success: true,
    rider
  })
})

/* VEHICLE REGISTER */
app.post('/api/vehicle/register', (req, res) => {
  const vehicles = read(VEHICLES)

  const vehicle = {
    id: uid(),
    type: req.body.type || 'human',
    name: req.body.name || '',
    vehicle: req.body.vehicle || '',
    plate: req.body.plate || '',
    zone: req.body.zone || 'default',
    battery: Number(req.body.battery || 100),
    status: 'online',
    available: true,
    remoteAssist: false,
    remoteOperatorId: null,
    takeoverMode: false,
    safetyState: 'normal',
    createdAt: new Date().toISOString()
  }

  vehicles.push(vehicle)
  write(VEHICLES, vehicles)

  res.json({
    success: true,
    vehicle
  })
})

/* GET VEHICLES */
app.get('/api/vehicles', (req, res) => {
  res.json(read(VEHICLES))
})

/* UPDATE VEHICLE STATUS */
app.post('/api/vehicle/:id/status', (req, res) => {
  const vehicles = read(VEHICLES)
  const vehicle = vehicles.find(v => v.id === req.params.id)

  if (!vehicle) {
    return res.status(404).json({ success: false, error: 'Vehicle not found' })
  }

  if (req.body.status) vehicle.status = req.body.status
  if (typeof req.body.available === 'boolean') vehicle.available = req.body.available
  if (req.body.zone) vehicle.zone = req.body.zone

  write(VEHICLES, vehicles)

  res.json({
    success: true,
    vehicle
  })
})

/* UPDATE VEHICLE BATTERY */
app.post('/api/vehicle/:id/battery', (req, res) => {
  const vehicles = read(VEHICLES)
  const vehicle = vehicles.find(v => v.id === req.params.id)

  if (!vehicle) {
    return res.status(404).json({ success: false, error: 'Vehicle not found' })
  }

  vehicle.battery = Number(req.body.battery || vehicle.battery)

  write(VEHICLES, vehicles)

  res.json({
    success: true,
    vehicle
  })
})

/* REMOTE ASSIST */
app.post('/api/vehicle/:id/remote-assist', (req, res) => {
  const vehicles = read(VEHICLES)
  const vehicle = vehicles.find(v => v.id === req.params.id)

  if (!vehicle) {
    return res.status(404).json({ success: false, error: 'Vehicle not found' })
  }

  vehicle.remoteAssist = !!req.body.remoteAssist
  vehicle.remoteOperatorId = req.body.remoteOperatorId || null
  vehicle.safetyState = vehicle.remoteAssist ? 'remote_assist' : 'normal'

  write(VEHICLES, vehicles)

  res.json({
    success: true,
    vehicle
  })
})

/* TAKEOVER MODE */
app.post('/api/vehicle/:id/takeover', (req, res) => {
  const vehicles = read(VEHICLES)
  const vehicle = vehicles.find(v => v.id === req.params.id)

  if (!vehicle) {
    return res.status(404).json({ success: false, error: 'Vehicle not found' })
  }

  vehicle.takeoverMode = !!req.body.takeoverMode
  vehicle.remoteOperatorId = req.body.remoteOperatorId || null
  vehicle.safetyState = vehicle.takeoverMode ? 'manual_override' : 'normal'

  write(VEHICLES, vehicles)

  res.json({
    success: true,
    vehicle
  })
})

/* REQUEST RIDE */
app.post('/api/request-ride', (req, res) => {
  const rides = read(RIDES)

  const ride = {
    id: uid(),
    rider: req.body.name || req.body.rider || '',
    phone: req.body.phone || req.body.riderPhone || '',
    pickup: req.body.pickup || '',
    dropoff: req.body.dropoff || '',
    zone: req.body.zone || 'default',
    status: 'searching',
    vehicle: null,
    mission: null,
    createdAt: new Date().toISOString()
  }

  rides.push(ride)
  write(RIDES, rides)

  smartDispatch(ride.id)

  const updatedRides = read(RIDES)
  const updatedRide = updatedRides.find(r => r.id === ride.id)

  res.json({
    success: true,
    ride: updatedRide
  })
})

/* GET RIDES */
app.get('/api/rides', (req, res) => {
  res.json(read(RIDES))
})

/* COMPLETE RIDE */
app.post('/api/rides/:id/complete', (req, res) => {
  const rides = read(RIDES)
  const vehicles = read(VEHICLES)
  const missions = read(MISSIONS)

  const ride = rides.find(r => r.id === req.params.id)

  if (!ride) {
    return res.status(404).json({ success: false, error: 'Ride not found' })
  }

  ride.status = 'completed'

  const vehicle = vehicles.find(v => v.id === ride.vehicle)
  if (vehicle) {
    vehicle.available = true
    vehicle.status = 'online'
    vehicle.remoteAssist = false
    vehicle.remoteOperatorId = null
    vehicle.takeoverMode = false
    vehicle.safetyState = 'normal'
  }

  const mission = missions.find(m => m.id === ride.mission)
  if (mission) {
    mission.status = 'completed'
    mission.updatedAt = new Date().toISOString()
    mission.timeline.push(timelineEntry('mission_completed', 'Ride completed'))
  }

  write(RIDES, rides)
  write(VEHICLES, vehicles)
  write(MISSIONS, missions)

  res.json({ success: true })
})

/* SMART DISPATCH */
function smartDispatch(rideId) {
  const rides = read(RIDES)
  const vehicles = read(VEHICLES)
  const missions = read(MISSIONS)

  const ride = rides.find(r => r.id === rideId)
  if (!ride) return

  const vehicle = vehicles.find(v =>
    v.available === true &&
    v.status === 'online' &&
    v.zone === ride.zone &&
    v.battery > 25 &&
    v.safetyState !== 'maintenance'
  )

  if (!vehicle) return

  vehicle.available = false
  ride.vehicle = vehicle.id
  ride.status = 'assigned'

  const mission = {
    id: uid(),
    rideId: ride.id,
    vehicleId: vehicle.id,
    vehicleType: vehicle.type,
    status: 'queued',
    pickup: ride.pickup,
    dropoff: ride.dropoff,
    remoteAssistRequired: false,
    remoteOperatorId: null,
    takeoverMode: false,
    timeline: [
      timelineEntry('mission_created', 'Mission queued after smart dispatch')
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  missions.push(mission)
  ride.mission = mission.id

  write(RIDES, rides)
  write(VEHICLES, vehicles)
  write(MISSIONS, missions)
}

/* GET MISSIONS */
app.get('/api/missions', (req, res) => {
  res.json(read(MISSIONS))
})

/* UPDATE MISSION STATUS */
app.post('/api/mission/:id/status', (req, res) => {
  const missions = read(MISSIONS)
  const rides = read(RIDES)

  const mission = missions.find(m => m.id === req.params.id)

  if (!mission) {
    return res.status(404).json({ success: false, error: 'Mission not found' })
  }

  mission.status = req.body.status || mission.status
  mission.updatedAt = new Date().toISOString()
  mission.timeline.push(timelineEntry('mission_status', mission.status))

  const ride = rides.find(r => r.id === mission.rideId)
  if (ride) {
    const rideStatusMap = {
      queued: 'assigned',
      sent: 'assigned',
      accepted: 'assigned',
      active: 'in_progress',
      arrived: 'arrived',
      completed: 'completed',
      cancelled: 'cancelled',
      remote_assist: 'remote_assist'
    }

    if (rideStatusMap[mission.status]) {
      ride.status = rideStatusMap[mission.status]
    }
  }

  write(MISSIONS, missions)
  write(RIDES, rides)

  res.json({
    success: true,
    mission
  })
})

/* MISSION REMOTE ASSIST */
app.post('/api/mission/:id/remote-assist', (req, res) => {
  const missions = read(MISSIONS)
  const vehicles = read(VEHICLES)

  const mission = missions.find(m => m.id === req.params.id)

  if (!mission) {
    return res.status(404).json({ success: false, error: 'Mission not found' })
  }

  mission.remoteAssistRequired = !!req.body.remoteAssistRequired
  mission.remoteOperatorId = req.body.remoteOperatorId || null
  mission.updatedAt = new Date().toISOString()

  if (mission.remoteAssistRequired) {
    mission.status = 'remote_assist'
  }

  mission.timeline.push(
    timelineEntry(
      'remote_assist',
      mission.remoteAssistRequired ? 'Remote assist requested' : 'Remote assist cleared'
    )
  )

  const vehicle = vehicles.find(v => v.id === mission.vehicleId)
  if (vehicle) {
    vehicle.remoteAssist = mission.remoteAssistRequired
    vehicle.remoteOperatorId = mission.remoteOperatorId
    vehicle.safetyState = mission.remoteAssistRequired ? 'remote_assist' : 'normal'
  }

  write(MISSIONS, missions)
  write(VEHICLES, vehicles)

  res.json({
    success: true,
    mission
  })
})

/* MISSION TAKEOVER */
app.post('/api/mission/:id/takeover', (req, res) => {
  const missions = read(MISSIONS)
  const vehicles = read(VEHICLES)

  const mission = missions.find(m => m.id === req.params.id)

  if (!mission) {
    return res.status(404).json({ success: false, error: 'Mission not found' })
  }

  mission.takeoverMode = !!req.body.takeoverMode
  mission.remoteOperatorId = req.body.remoteOperatorId || null
  mission.updatedAt = new Date().toISOString()
  mission.timeline.push(
    timelineEntry(
      'takeover',
      mission.takeoverMode ? 'Manual takeover enabled' : 'Manual takeover released'
    )
  )

  const vehicle = vehicles.find(v => v.id === mission.vehicleId)
  if (vehicle) {
    vehicle.takeoverMode = mission.takeoverMode
    vehicle.remoteOperatorId = mission.remoteOperatorId
    vehicle.safetyState = mission.takeoverMode ? 'manual_override' : 'normal'
  }

  write(MISSIONS, missions)
  write(VEHICLES, vehicles)

  res.json({
    success: true,
    mission
  })
})

/* SEND VEHICLE COMMAND */
app.post('/api/vehicle/:id/command', (req, res) => {
  const commands = read(COMMANDS)

  const command = {
    id: uid(),
    vehicleId: req.params.id,
    type: req.body.type || '',
    data: req.body.data || {},
    status: 'queued',
    createdAt: new Date().toISOString()
  }

  commands.push(command)
  write(COMMANDS, commands)

  res.json({
    success: true,
    command
  })
})

/* GET VEHICLE COMMANDS */
app.get('/api/vehicle/:id/commands', (req, res) => {
  const commands = read(COMMANDS)
  const filtered = commands.filter(c => c.vehicleId === req.params.id)
  res.json(filtered)
})

/* UPDATE COMMAND STATUS */
app.post('/api/command/:id/status', (req, res) => {
  const commands = read(COMMANDS)
  const command = commands.find(c => c.id === req.params.id)

  if (!command) {
    return res.status(404).json({ success: false, error: 'Command not found' })
  }

  command.status = req.body.status || command.status
  write(COMMANDS, commands)

  res.json({
    success: true,
    command
  })
})

/* EMERGENCY STOP */
app.post('/api/vehicle/:id/emergency-stop', (req, res) => {
  const vehicles = read(VEHICLES)
  const vehicle = vehicles.find(v => v.id === req.params.id)

  if (!vehicle) {
    return res.status(404).json({ success: false, error: 'Vehicle not found' })
  }

  vehicle.status = 'emergency_stop'
  vehicle.available = false
  vehicle.safetyState = 'emergency_stop'

  write(VEHICLES, vehicles)

  res.json({
    success: true,
    vehicle
  })
})

/* RETURN TO BASE */
app.post('/api/vehicle/:id/return-base', (req, res) => {
  const vehicles = read(VEHICLES)
  const vehicle = vehicles.find(v => v.id === req.params.id)

  if (!vehicle) {
    return res.status(404).json({ success: false, error: 'Vehicle not found' })
  }

  vehicle.status = 'returning'
  vehicle.available = false

  write(VEHICLES, vehicles)

  res.json({
    success: true,
    vehicle
  })
})

/* RESUME AUTONOMOUS */
app.post('/api/vehicle/:id/resume', (req, res) => {
  const vehicles = read(VEHICLES)
  const vehicle = vehicles.find(v => v.id === req.params.id)

  if (!vehicle) {
    return res.status(404).json({ success: false, error: 'Vehicle not found' })
  }

  vehicle.status = 'online'
  vehicle.available = true
  vehicle.remoteAssist = false
  vehicle.takeoverMode = false
  vehicle.remoteOperatorId = null
  vehicle.safetyState = 'normal'

  write(VEHICLES, vehicles)

  res.json({
    success: true,
    vehicle
  })
})

/* SEND MESSAGE */
app.post('/api/send-message', (req, res) => {
  const messages = read(MESSAGES)

  const message = {
    id: uid(),
    rideId: req.body.rideId || 'support',
    from: req.body.from || 'user',
    to: req.body.to || 'admin',
    text: req.body.text || '',
    time: new Date().toISOString()
  }

  messages.push(message)
  write(MESSAGES, messages)

  res.json({
    success: true,
    message
  })
})

/* GET MESSAGES */
app.get('/api/messages/:rideId', (req, res) => {
  const messages = read(MESSAGES)
  const filtered = messages.filter(m => String(m.rideId) === String(req.params.rideId))
  res.json(filtered)
})

/* PAGE ROUTER */
app.get('/:page', (req, res) => {
  const file = path.join(__dirname, 'public', req.params.page)

  if (fs.existsSync(file)) {
    return res.sendFile(file)
  }

  if (fs.existsSync(file + '.html')) {
    return res.sendFile(file + '.html')
  }

  return res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => {
  console.log('Harvey Taxi AV Control System running on port ' + PORT)
})
