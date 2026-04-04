const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const DATA_DIR = __dirname

const FILES = {
  rides: path.join(DATA_DIR, 'rides.json'),
  gps: path.join(DATA_DIR, 'gps-locations.json'),
  vehicles: path.join(DATA_DIR, 'vehicles.json'),
  riders: path.join(DATA_DIR, 'riders.json'),
  messages: path.join(DATA_DIR, 'messages.json'),
  commands: path.join(DATA_DIR, 'commands.json'),
  missions: path.join(DATA_DIR, 'missions.json'),
  dispatches: path.join(DATA_DIR, 'dispatches.json')
}

const DISPATCH_TIMEOUT_MS = 20000

function ensureFile(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2))
  }
}

function readJson(filePath, defaultValue = []) {
  ensureFile(filePath, defaultValue)
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return raw ? JSON.parse(raw) : defaultValue
  } catch (err) {
    console.error(`Failed reading ${filePath}:`, err.message)
    return defaultValue
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function toRad(value) {
  return (value * Math.PI) / 180
}

function distanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Sanitizers
 * These ensure frontend only sees addresses, never coordinates.
 */
function hideRideCoordinates(ride) {
  if (!ride) return null
  const copy = { ...ride }
  delete copy.pickupLat
  delete copy.pickupLng
  delete copy.dropoffLat
  delete copy.dropoffLng
  return copy
}

function hideDispatchCoordinates(dispatch) {
  if (!dispatch) return null
  const copy = { ...dispatch }

  if (copy.pickup) {
    copy.pickup = {
      address: copy.pickup.address
    }
  }

  if (copy.dropoff) {
    copy.dropoff = {
      address: copy.dropoff.address
    }
  }

  return copy
}

function sanitizeGpsRowsForFrontend(gpsRows) {
  return gpsRows.map(row => ({
    entityId: row.entityId,
    updatedAt: row.updatedAt,
    status: row.status || 'active'
  }))
}

function getGpsMap() {
  const gpsRows = readJson(FILES.gps, [])
  const map = {}
  for (const row of gpsRows) {
    map[row.entityId] = row
  }
  return map
}

function getAllVehicles() {
  return readJson(FILES.vehicles, [])
}

function getAllRides() {
  return readJson(FILES.rides, [])
}

function getAllDispatches() {
  return readJson(FILES.dispatches, [])
}

function getVehicleLocation(vehicle, gpsMap) {
  const gps = gpsMap[vehicle.id] || gpsMap[vehicle.driverId]
  return {
    lat: Number(gps?.lat ?? vehicle.lat ?? 0),
    lng: Number(gps?.lng ?? vehicle.lng ?? 0)
  }
}

function isVehicleEligible(vehicle) {
  if (!vehicle) return false

  if (vehicle.type === 'human') {
    return (
      vehicle.isApproved === true &&
      vehicle.isOnline === true &&
      vehicle.status !== 'busy' &&
      vehicle.status !== 'offline'
    )
  }

  if (vehicle.type === 'av') {
    return (
      vehicle.isOnline === true &&
      vehicle.status !== 'busy' &&
      vehicle.status !== 'maintenance'
    )
  }

  return false
}

function rankCandidatesForRide(ride) {
  const vehicles = getAllVehicles()
  const gpsMap = getGpsMap()

  const pickupLat = Number(ride.pickupLat)
  const pickupLng = Number(ride.pickupLng)

  const candidates = vehicles
    .filter(isVehicleEligible)
    .map(vehicle => {
      const loc = getVehicleLocation(vehicle, gpsMap)
      const milesAway = distanceMiles(pickupLat, pickupLng, loc.lat, loc.lng)

      let typePriority = 2
      if (vehicle.type === 'human') typePriority = 1
      if (vehicle.type === 'av') typePriority = 2

      return {
        ...vehicle,
        milesAway,
        currentLat: loc.lat,
        currentLng: loc.lng,
        typePriority
      }
    })
    .sort((a, b) => {
      if (a.typePriority !== b.typePriority) {
        return a.typePriority - b.typePriority
      }
      return a.milesAway - b.milesAway
    })

  return candidates
}

function updateVehicle(vehicleId, updater) {
  const vehicles = getAllVehicles()
  const index = vehicles.findIndex(v => v.id === vehicleId)
  if (index === -1) return null
  vehicles[index] = updater(vehicles[index])
  writeJson(FILES.vehicles, vehicles)
  return vehicles[index]
}

function updateRide(rideId, updater) {
  const rides = getAllRides()
  const index = rides.findIndex(r => r.id === rideId)
  if (index === -1) return null
  rides[index] = updater(rides[index])
  writeJson(FILES.rides, rides)
  return rides[index]
}

function updateDispatch(dispatchId, updater) {
  const dispatches = getAllDispatches()
  const index = dispatches.findIndex(d => d.id === dispatchId)
  if (index === -1) return null
  dispatches[index] = updater(dispatches[index])
  writeJson(FILES.dispatches, dispatches)
  return dispatches[index]
}

function addMessage(message) {
  const messages = readJson(FILES.messages, [])
  messages.push(message)
  writeJson(FILES.messages, messages)
}

function addMission(mission) {
  const missions = readJson(FILES.missions, [])
  missions.push(mission)
  writeJson(FILES.missions, missions)
}

function addCommand(command) {
  const commands = readJson(FILES.commands, [])
  commands.push(command)
  writeJson(FILES.commands, commands)
}

function createDispatchOffer(ride, vehicle, attemptNumber) {
  const dispatches = getAllDispatches()

  const dispatch = {
    id: uid('dispatch'),
    rideId: ride.id,
    riderId: ride.riderId || null,
    vehicleId: vehicle.id,
    driverId: vehicle.driverId || null,
    fleetType: vehicle.type,
    status: vehicle.type === 'av' ? 'accepted' : 'offered',
    attemptNumber,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + DISPATCH_TIMEOUT_MS).toISOString(),
    pickup: {
      address: ride.pickup,
      lat: Number(ride.pickupLat),
      lng: Number(ride.pickupLng)
    },
    dropoff: {
      address: ride.dropoff,
      lat: Number(ride.dropoffLat),
      lng: Number(ride.dropoffLng)
    },
    milesAway: vehicle.milesAway
  }

  dispatches.push(dispatch)
  writeJson(FILES.dispatches, dispatches)

  if (vehicle.type === 'av') {
    updateVehicle(vehicle.id, v => ({
      ...v,
      status: 'busy',
      activeRideId: ride.id,
      currentDispatchId: dispatch.id
    }))

    updateRide(ride.id, r => ({
      ...r,
      status: 'assigned',
      assignedVehicleId: vehicle.id,
      assignedDriverId: null,
      fleetType: 'av',
      dispatchId: dispatch.id,
      assignedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }))

    addMission({
      id: uid('mission'),
      vehicleId: vehicle.id,
      rideId: ride.id,
      missionType: 'pickup_and_dropoff',
      status: 'queued',
      pickup: dispatch.pickup,
      dropoff: dispatch.dropoff,
      createdAt: new Date().toISOString()
    })

    addCommand({
      id: uid('command'),
      vehicleId: vehicle.id,
      type: 'GO_TO_PICKUP',
      payload: {
        rideId: ride.id,
        pickup: dispatch.pickup,
        dropoff: dispatch.dropoff
      },
      createdAt: new Date().toISOString(),
      status: 'queued'
    })

    addMessage({
      id: uid('msg'),
      rideId: ride.id,
      sender: 'system',
      text: 'Autonomous vehicle assigned to this ride.',
      createdAt: new Date().toISOString()
    })

    updateDispatch(dispatch.id, d => ({
      ...d,
      status: 'accepted',
      acceptedAt: new Date().toISOString()
    }))

    return {
      success: true,
      dispatch: hideDispatchCoordinates(dispatch),
      autoAccepted: true
    }
  }

  updateVehicle(vehicle.id, v => ({
    ...v,
    status: 'offered',
    pendingRideId: ride.id,
    currentDispatchId: dispatch.id
  }))

  updateRide(ride.id, r => ({
    ...r,
    status: 'dispatching',
    assignedVehicleId: vehicle.id,
    assignedDriverId: vehicle.driverId || null,
    fleetType: 'human',
    dispatchId: dispatch.id,
    dispatchOfferedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }))

  addMessage({
    id: uid('msg'),
    rideId: ride.id,
    sender: 'system',
    text: `Dispatch offer sent to driver ${vehicle.driverId || vehicle.id}.`,
    createdAt: new Date().toISOString()
  })

  return {
    success: true,
    dispatch: hideDispatchCoordinates(dispatch),
    autoAccepted: false
  }
}

function startDispatchFlow(rideId) {
  const rides = getAllRides()
  const ride = rides.find(r => r.id === rideId)

  if (!ride) {
    return { success: false, error: 'Ride not found.' }
  }

  const previousDispatches = getAllDispatches().filter(d => d.rideId === rideId)
  const excludedVehicleIds = previousDispatches.map(d => d.vehicleId)

  const candidates = rankCandidatesForRide(ride).filter(
    candidate => !excludedVehicleIds.includes(candidate.id)
  )

  if (candidates.length === 0) {
    updateRide(ride.id, r => ({
      ...r,
      status: 'unassigned',
      dispatchId: null,
      assignedVehicleId: null,
      assignedDriverId: null,
      fleetType: null,
      unassignedReason: 'No available human or AV vehicle found.',
      updatedAt: new Date().toISOString()
    }))

    return {
      success: false,
      error: 'No available vehicles found.'
    }
  }

  const nextVehicle = candidates[0]
  return createDispatchOffer(ride, nextVehicle, previousDispatches.length + 1)
}

function failAndFallback(dispatchId, reason = 'timeout') {
  const dispatches = getAllDispatches()
  const dispatch = dispatches.find(d => d.id === dispatchId)

  if (!dispatch) return
  if (dispatch.status !== 'offered') return

  updateDispatch(dispatch.id, d => ({
    ...d,
    status: 'expired',
    expiredAt: new Date().toISOString(),
    failureReason: reason
  }))

  updateVehicle(dispatch.vehicleId, v => ({
    ...v,
    status: 'online',
    pendingRideId: null,
    currentDispatchId: null
  }))

  updateRide(dispatch.rideId, r => ({
    ...r,
    status: 'searching',
    dispatchId: null,
    assignedVehicleId: null,
    assignedDriverId: null,
    fleetType: null,
    updatedAt: new Date().toISOString()
  }))

  addMessage({
    id: uid('msg'),
    rideId: dispatch.rideId,
    sender: 'system',
    text: `Dispatch ${dispatch.id} failed due to ${reason}. Trying next vehicle.`,
    createdAt: new Date().toISOString()
  })

  startDispatchFlow(dispatch.rideId)
}

setInterval(() => {
  const dispatches = getAllDispatches()
  const now = Date.now()

  dispatches.forEach(dispatch => {
    if (
      dispatch.status === 'offered' &&
      dispatch.expiresAt &&
      new Date(dispatch.expiresAt).getTime() < now
    ) {
      failAndFallback(dispatch.id, 'timeout')
    }
  })
}, 5000)

/**
 * Routes
 */

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'))
})

app.get('/:page', (req, res, next) => {
  const filePath = path.join(__dirname, 'public', req.params.page)
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath)
  }
  next()
})

/**
 * GPS routes
 * Note: frontend gets sanitized GPS records only.
 * Full coordinates remain internal on disk for dispatch logic.
 */
app.post('/api/gps/update', (req, res) => {
  const { entityId, lat, lng, speed, heading, status } = req.body

  if (!entityId || lat === undefined || lng === undefined) {
    return res.status(400).json({
      error: 'entityId, lat, and lng are required.'
    })
  }

  const gpsRows = readJson(FILES.gps, [])
  const index = gpsRows.findIndex(row => row.entityId === entityId)

  const record = {
    entityId,
    lat: Number(lat),
    lng: Number(lng),
    speed: Number(speed || 0),
    heading: Number(heading || 0),
    status: status || 'active',
    updatedAt: new Date().toISOString()
  }

  if (index === -1) {
    gpsRows.push(record)
  } else {
    gpsRows[index] = { ...gpsRows[index], ...record }
  }

  writeJson(FILES.gps, gpsRows)

  res.json({
    success: true,
    gps: {
      entityId: record.entityId,
      updatedAt: record.updatedAt,
      status: record.status
    }
  })
})

app.get('/api/gps/all', (req, res) => {
  const gpsRows = readJson(FILES.gps, [])
  res.json(sanitizeGpsRowsForFrontend(gpsRows))
})

/**
 * Vehicle status
 */
app.post('/api/vehicle/status', (req, res) => {
  const { vehicleId, isOnline, status } = req.body

  if (!vehicleId) {
    return res.status(400).json({ error: 'vehicleId is required.' })
  }

  const updated = updateVehicle(vehicleId, v => ({
    ...v,
    isOnline: typeof isOnline === 'boolean' ? isOnline : v.isOnline,
    status: status || v.status,
    updatedAt: new Date().toISOString()
  }))

  if (!updated) {
    return res.status(404).json({ error: 'Vehicle not found.' })
  }

  res.json({
    success: true,
    vehicle: {
      id: updated.id,
      type: updated.type,
      driverId: updated.driverId || null,
      name: updated.name || '',
      isApproved: updated.isApproved === true,
      isOnline: updated.isOnline === true,
      status: updated.status,
      updatedAt: updated.updatedAt
    }
  })
})

/**
 * Driver offers
 * Only returns address-based details.
 */
app.get('/api/driver/offers/:driverId', (req, res) => {
  const { driverId } = req.params
  const dispatches = getAllDispatches()

  const offer = dispatches
    .filter(d => d.driverId === driverId && d.status === 'offered')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]

  if (!offer) {
    return res.json({
      success: true,
      offer: null
    })
  }

  const rides = getAllRides()
  const ride = rides.find(r => r.id === offer.rideId) || null

  res.json({
    success: true,
    offer: {
      ...hideDispatchCoordinates(offer),
      ride: ride ? hideRideCoordinates(ride) : null
    }
  })
})

app.post('/api/dispatch/respond', (req, res) => {
  const { dispatchId, driverId, action } = req.body

  if (!dispatchId || !driverId || !action) {
    return res.status(400).json({
      error: 'dispatchId, driverId, and action are required.'
    })
  }

  const dispatches = getAllDispatches()
  const dispatch = dispatches.find(d => d.id === dispatchId)

  if (!dispatch) {
    return res.status(404).json({ error: 'Dispatch not found.' })
  }

  if (dispatch.driverId !== driverId) {
    return res.status(403).json({
      error: 'This dispatch does not belong to this driver.'
    })
  }

  if (dispatch.status !== 'offered') {
    return res.status(400).json({
      error: 'Dispatch is no longer active.'
    })
  }

  if (action === 'decline') {
    updateDispatch(dispatch.id, d => ({
      ...d,
      status: 'declined',
      declinedAt: new Date().toISOString()
    }))

    updateVehicle(dispatch.vehicleId, v => ({
      ...v,
      status: 'online',
      pendingRideId: null,
      currentDispatchId: null
    }))

    updateRide(dispatch.rideId, r => ({
      ...r,
      status: 'searching',
      dispatchId: null,
      assignedVehicleId: null,
      assignedDriverId: null,
      fleetType: null,
      updatedAt: new Date().toISOString()
    }))

    addMessage({
      id: uid('msg'),
      rideId: dispatch.rideId,
      sender: 'system',
      text: `Driver ${driverId} declined dispatch.`,
      createdAt: new Date().toISOString()
    })

    const fallback = startDispatchFlow(dispatch.rideId)

    return res.json({
      success: true,
      message: 'Dispatch declined.',
      fallback
    })
  }

  if (action === 'accept') {
    updateDispatch(dispatch.id, d => ({
      ...d,
      status: 'accepted',
      acceptedAt: new Date().toISOString()
    }))

    updateVehicle(dispatch.vehicleId, v => ({
      ...v,
      status: 'busy',
      pendingRideId: null,
      activeRideId: dispatch.rideId,
      currentDispatchId: dispatch.id
    }))

    const updatedRide = updateRide(dispatch.rideId, r => ({
      ...r,
      status: 'assigned',
      dispatchId: dispatch.id,
      assignedVehicleId: dispatch.vehicleId,
      assignedDriverId: driverId,
      fleetType: 'human',
      acceptedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }))

    addMessage({
      id: uid('msg'),
      rideId: dispatch.rideId,
      sender: 'system',
      text: `Driver ${driverId} accepted the ride.`,
      createdAt: new Date().toISOString()
    })

    return res.json({
      success: true,
      message: 'Dispatch accepted.',
      ride: hideRideCoordinates(updatedRide)
    })
  }

  return res.status(400).json({
    error: 'action must be accept or decline.'
  })
})

/**
 * Ride request
 * Frontend should send addresses.
 * Coordinates may be included in hidden fields or geocoded later.
 * Response is always sanitized.
 */
app.post('/api/request-ride', (req, res) => {
  const {
    riderId,
    riderName,
    pickup,
    dropoff,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    rideType
  } = req.body

  if (!pickup || !dropoff) {
    return res.status(400).json({
      error: 'pickup and dropoff are required.'
    })
  }

  if (
    pickupLat === undefined ||
    pickupLng === undefined ||
    dropoffLat === undefined ||
    dropoffLng === undefined
  ) {
    return res.status(400).json({
      error: 'Backend dispatch still requires hidden pickup/dropoff coordinates.'
    })
  }

  const ride = {
    id: uid('ride'),
    riderId: riderId || null,
    riderName: riderName || 'Unknown Rider',
    pickup,
    dropoff,
    pickupLat: Number(pickupLat),
    pickupLng: Number(pickupLng),
    dropoffLat: Number(dropoffLat),
    dropoffLng: Number(dropoffLng),
    rideType: rideType || 'standard',
    status: 'searching',
    assignedVehicleId: null,
    assignedDriverId: null,
    fleetType: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  const rides = getAllRides()
  rides.push(ride)
  writeJson(FILES.rides, rides)

  addMessage({
    id: uid('msg'),
    rideId: ride.id,
    sender: 'system',
    text: 'Ride created. Starting dispatch search.',
    createdAt: new Date().toISOString()
  })

  const dispatchResult = startDispatchFlow(ride.id)
  const refreshedRide = getAllRides().find(r => r.id === ride.id)

  res.json({
    success: true,
    ride: hideRideCoordinates(refreshedRide),
    dispatchResult: dispatchResult.dispatch
      ? { ...dispatchResult, dispatch: hideDispatchCoordinates(dispatchResult.dispatch) }
      : dispatchResult
  })
})

app.get('/api/rides', (req, res) => {
  const rides = getAllRides()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(hideRideCoordinates)

  res.json(rides)
})

app.get('/api/rides/:rideId', (req, res) => {
  const ride = getAllRides().find(r => r.id === req.params.rideId)

  if (!ride) {
    return res.status(404).json({ error: 'Ride not found.' })
  }

  res.json(hideRideCoordinates(ride))
})

app.post('/api/rides/:rideId/status', (req, res) => {
  const { rideId } = req.params
  const { status } = req.body

  if (!status) {
    return res.status(400).json({ error: 'status is required.' })
  }

  const updatedRide = updateRide(rideId, r => ({
    ...r,
    status,
    updatedAt: new Date().toISOString()
  }))

  if (!updatedRide) {
    return res.status(404).json({ error: 'Ride not found.' })
  }

  if (status === 'completed' || status === 'cancelled') {
    if (updatedRide.assignedVehicleId) {
      updateVehicle(updatedRide.assignedVehicleId, v => ({
        ...v,
        status: 'online',
        activeRideId: null,
        currentDispatchId: null
      }))
    }
  }

  res.json({
    success: true,
    ride: hideRideCoordinates(updatedRide)
  })
})

/**
 * Admin routes
 * Admin sees addresses only in these endpoints.
 */
app.get('/api/admin/dispatches', (req, res) => {
  const dispatches = getAllDispatches()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(hideDispatchCoordinates)

  res.json(dispatches)
})

app.get('/api/admin/active-dispatches', (req, res) => {
  const dispatches = getAllDispatches()
    .filter(d => ['offered', 'accepted'].includes(d.status))
    .map(hideDispatchCoordinates)

  res.json(dispatches)
})

app.post('/api/admin/manual-dispatch', (req, res) => {
  const { rideId, vehicleId } = req.body

  if (!rideId || !vehicleId) {
    return res.status(400).json({
      error: 'rideId and vehicleId are required.'
    })
  }

  const ride = getAllRides().find(r => r.id === rideId)
  const vehicle = getAllVehicles().find(v => v.id === vehicleId)

  if (!ride) {
    return res.status(404).json({ error: 'Ride not found.' })
  }

  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found.' })
  }

  if (!isVehicleEligible(vehicle)) {
    return res.status(400).json({
      error: 'Vehicle is not eligible right now.'
    })
  }

  if (ride.dispatchId) {
    updateDispatch(ride.dispatchId, d => ({
      ...d,
      status: 'replaced_by_admin',
      replacedAt: new Date().toISOString()
    }))
  }

  updateRide(ride.id, r => ({
    ...r,
    status: 'searching',
    dispatchId: null,
    assignedVehicleId: null,
    assignedDriverId: null,
    fleetType: null,
    updatedAt: new Date().toISOString()
  }))

  const rankedVehicle = {
    ...vehicle,
    milesAway: 0
  }

  const result = createDispatchOffer(ride, rankedVehicle, 999)

  res.json({
    success: true,
    result: result.dispatch
      ? { ...result, dispatch: hideDispatchCoordinates(result.dispatch) }
      : result
  })
})

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    service: 'Harvey Taxi Dispatch Brain',
    mode: 'address_only_frontend',
    time: new Date().toISOString()
  })
})

ensureFile(FILES.rides, [])
ensureFile(FILES.gps, [])
ensureFile(FILES.vehicles, [])
ensureFile(FILES.riders, [])
ensureFile(FILES.messages, [])
ensureFile(FILES.commands, [])
ensureFile(FILES.missions, [])
ensureFile(FILES.dispatches, [])

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`)
})
