const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
require('dotenv').config()

const { createClient } = require('@supabase/supabase-js')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// -------------------------
// ENV VALIDATION
// -------------------------
const REQUIRED_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GOOGLE_MAPS_API_KEY'
]

const missingEnv = REQUIRED_ENV_VARS.filter((key) => !process.env[key])

if (missingEnv.length > 0) {
  console.error('Missing required environment variables:', missingEnv.join(', '))
  process.exit(1)
}

const DISPATCH_MODE = process.env.DISPATCH_MODE || 'mixed'
const AV_ENABLED = String(process.env.AV_ENABLED || 'true') === 'true'
const HUMAN_DRIVER_ENABLED = String(process.env.HUMAN_DRIVER_ENABLED || 'true') === 'true'
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// -------------------------
// FETCH HELPER
// -------------------------
async function safeFetch(url, options = {}) {
  if (typeof fetch !== 'undefined') {
    return fetch(url, options)
  }

  const nodeFetch = (...args) =>
    import('node-fetch').then(({ default: f }) => f(...args))

  return nodeFetch(url, options)
}

// -------------------------
// HELPERS
// -------------------------
function normalizeText(value) {
  return String(value || '').trim()
}

function toRadians(deg) {
  return deg * (Math.PI / 180)
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function sanitizeRide(ride) {
  return {
    id: ride.id,
    rider_name: ride.rider_name,
    rider_id: ride.rider_id,
    pickup_address: ride.pickup_address,
    dropoff_address: ride.dropoff_address,
    driver_id: ride.driver_id,
    vehicle_type: ride.vehicle_type,
    fleet_type: ride.fleet_type,
    status: ride.status,
    dispatch_mode: ride.dispatch_mode,
    created_at: ride.created_at,
    accepted_at: ride.accepted_at,
    started_at: ride.started_at,
    completed_at: ride.completed_at
  }
}

function maskDriverForClient(driver, distanceMiles = null) {
  return {
    id: driver.id,
    name: driver.name,
    type: driver.type,
    status: driver.status,
    vehicle_type: driver.vehicle_type,
    current_address: driver.current_address,
    distance_miles: distanceMiles === null ? null : Number(distanceMiles.toFixed(2))
  }
}

async function geocodeAddress(address) {
  const safeAddress = normalizeText(address)

  if (!safeAddress) {
    throw new Error('Address is required')
  }

  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?address=' +
    encodeURIComponent(safeAddress) +
    '&key=' +
    encodeURIComponent(GOOGLE_MAPS_API_KEY)

  const response = await safeFetch(url)
  const data = await response.json()

  if (data.status !== 'OK' || !data.results || !data.results.length) {
    throw new Error(`Geocoding failed for address: ${safeAddress}`)
  }

  const result = data.results[0]

  return {
    formatted_address: result.formatted_address,
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng
  }
}

async function fetchAvailableFleet() {
  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .in('status', ['available', 'online'])
    .order('updated_at', { ascending: false })

  if (error) throw error

  return (data || []).filter((unit) => {
    if (unit.type === 'av' && !AV_ENABLED) return false
    if (unit.type === 'human' && !HUMAN_DRIVER_ENABLED) return false
    return true
  })
}

function chooseCandidateByMode(candidates) {
  if (!candidates.length) return null

  const avCandidates = candidates.filter((c) => c.type === 'av')
  const humanCandidates = candidates.filter((c) => c.type === 'human')

  if (DISPATCH_MODE === 'av_first') {
    return avCandidates[0] || humanCandidates[0] || null
  }

  if (DISPATCH_MODE === 'human_first') {
    return humanCandidates[0] || avCandidates[0] || null
  }

  return candidates[0] || null
}

async function lockDriverAndCreateRide({
  rider_name,
  rider_id,
  pickup_address,
  pickup_lat,
  pickup_lng,
  dropoff_address,
  dropoff_lat,
  dropoff_lng,
  selectedDriver
}) {
  const now = new Date().toISOString()

  const { data: lockedDriver, error: lockError } = await supabase
    .from('drivers')
    .update({
      status: 'assigned',
      updated_at: now
    })
    .eq('id', selectedDriver.id)
    .in('status', ['available', 'online'])
    .select('*')
    .single()

  if (lockError || !lockedDriver) {
    throw new Error('Driver lock failed. Unit may already be assigned.')
  }

  const ridePayload = {
    rider_name,
    rider_id: rider_id || null,
    pickup_address,
    pickup_lat,
    pickup_lng,
    dropoff_address,
    dropoff_lat,
    dropoff_lng,
    driver_id: lockedDriver.id,
    vehicle_type: lockedDriver.vehicle_type || null,
    fleet_type: lockedDriver.type,
    status: 'assigned',
    dispatch_mode: DISPATCH_MODE,
    created_at: now,
    accepted_at: now
  }

  const { data: ride, error: rideError } = await supabase
    .from('rides')
    .insert([ridePayload])
    .select('*')
    .single()

  if (rideError) {
    await supabase
      .from('drivers')
      .update({
        status: 'available',
        updated_at: new Date().toISOString()
      })
      .eq('id', lockedDriver.id)

    throw rideError
  }

  const { error: queueError } = await supabase
    .from('dispatch_queue')
    .insert([
      {
        ride_id: ride.id,
        pickup_address,
        dropoff_address,
        assigned: true,
        assigned_driver_id: lockedDriver.id,
        fleet_type: lockedDriver.type,
        status: 'assigned',
        created_at: now,
        updated_at: now
      }
    ])

  if (queueError) {
    console.error('Dispatch queue warning:', queueError.message)
  }

  return { ride, lockedDriver }
}

// -------------------------
// STATIC ROUTES
// -------------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/:page', (req, res, next) => {
  const requested = req.params.page

  if (!requested.endsWith('.html')) return next()

  const filePath = path.join(__dirname, 'public', requested)

  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath)
  }

  return res.status(404).send('Page not found')
})

// -------------------------
// HEALTH
// -------------------------
app.get('/api/health', async (req, res) => {
  try {
    const { error } = await supabase.from('drivers').select('id').limit(1)
    if (error) throw error

    res.json({
      ok: true,
      service: 'Harvey Taxi Dispatch Brain',
      dispatch_mode: DISPATCH_MODE,
      av_enabled: AV_ENABLED,
      human_driver_enabled: HUMAN_DRIVER_ENABLED
    })
  } catch (error) {
    console.error('HEALTH ERROR:', error.message)
    res.status(500).json({
      ok: false,
      error: error.message
    })
  }
})

// -------------------------
// REQUEST RIDE
// -------------------------
app.post('/api/request-ride', async (req, res) => {
  try {
    const rider_name = normalizeText(req.body.rider_name)
    const rider_id = normalizeText(req.body.rider_id)
    const pickup_address_input = normalizeText(req.body.pickup_address)
    const dropoff_address_input = normalizeText(req.body.dropoff_address)

    if (!rider_name || !pickup_address_input || !dropoff_address_input) {
      return res.status(400).json({
        error: 'rider_name, pickup_address, and dropoff_address are required'
      })
    }

    const pickupGeo = await geocodeAddress(pickup_address_input)
    const dropoffGeo = await geocodeAddress(dropoff_address_input)

    const availableFleet = await fetchAvailableFleet()

    const candidates = availableFleet
      .filter(
        (unit) =>
          typeof unit.lat === 'number' &&
          typeof unit.lng === 'number' &&
          !!unit.current_address
      )
      .map((unit) => ({
        ...unit,
        distanceMiles: haversineMiles(
          pickupGeo.lat,
          pickupGeo.lng,
          unit.lat,
          unit.lng
        )
      }))
      .sort((a, b) => a.distanceMiles - b.distanceMiles)

    const selectedDriver = chooseCandidateByMode(candidates)

    if (!selectedDriver) {
      const { error: queueError } = await supabase
        .from('dispatch_queue')
        .insert([
          {
            pickup_address: pickupGeo.formatted_address,
            dropoff_address: dropoffGeo.formatted_address,
            assigned: false,
            assigned_driver_id: null,
            fleet_type: 'unassigned',
            status: 'waiting',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ])

      if (queueError) {
        console.error('Waiting queue insert error:', queueError.message)
      }

      return res.status(404).json({
        error: 'No available driver or AV found',
        dispatch_mode: DISPATCH_MODE
      })
    }

    const { ride, lockedDriver } = await lockDriverAndCreateRide({
      rider_name,
      rider_id,
      pickup_address: pickupGeo.formatted_address,
      pickup_lat: pickupGeo.lat,
      pickup_lng: pickupGeo.lng,
      dropoff_address: dropoffGeo.formatted_address,
      dropoff_lat: dropoffGeo.lat,
      dropoff_lng: dropoffGeo.lng,
      selectedDriver
    })

    const distanceMiles = haversineMiles(
      pickupGeo.lat,
      pickupGeo.lng,
      lockedDriver.lat,
      lockedDriver.lng
    )

    res.json({
      success: true,
      message: 'Ride dispatched successfully',
      dispatch_mode: DISPATCH_MODE,
      ride: sanitizeRide(ride),
      assigned_unit: maskDriverForClient(lockedDriver, distanceMiles)
    })
  } catch (error) {
    console.error('REQUEST RIDE ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

// -------------------------
// RIDES
// -------------------------
app.get('/api/rides', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('rides')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error

    res.json((data || []).map(sanitizeRide))
  } catch (error) {
    console.error('GET RIDES ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/rides/:rideId', async (req, res) => {
  try {
    const { rideId } = req.params

    const { data, error } = await supabase
      .from('rides')
      .select('*')
      .eq('id', rideId)
      .single()

    if (error) throw error

    res.json(sanitizeRide(data))
  } catch (error) {
    console.error('GET RIDE ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/rides/:rideId/status', async (req, res) => {
  try {
    const { rideId } = req.params
    const nextStatus = normalizeText(req.body.status)

    const allowedStatuses = [
      'assigned',
      'accepted',
      'enroute',
      'arrived',
      'in_trip',
      'completed',
      'cancelled'
    ]

    if (!allowedStatuses.includes(nextStatus)) {
      return res.status(400).json({ error: 'Invalid ride status' })
    }

    const patch = { status: nextStatus }

    if (nextStatus === 'accepted') patch.accepted_at = new Date().toISOString()
    if (nextStatus === 'in_trip') patch.started_at = new Date().toISOString()
    if (nextStatus === 'completed') patch.completed_at = new Date().toISOString()

    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .update(patch)
      .eq('id', rideId)
      .select('*')
      .single()

    if (rideError) throw rideError

    await supabase
      .from('dispatch_queue')
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString()
      })
      .eq('ride_id', rideId)

    if (nextStatus === 'completed' || nextStatus === 'cancelled') {
      await supabase
        .from('drivers')
        .update({
          status: 'available',
          updated_at: new Date().toISOString()
        })
        .eq('id', ride.driver_id)
    }

    res.json({
      success: true,
      ride: sanitizeRide(ride)
    })
  } catch (error) {
    console.error('UPDATE RIDE STATUS ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

// -------------------------
// FLEET
// -------------------------
app.get('/api/admin/fleet', async (req, res) => {
  try {
    const { data: drivers, error } = await supabase.from('drivers').select('*')
    if (error) throw error

    const fleet = drivers || []

    const active = fleet.filter((d) =>
      ['assigned', 'enroute', 'arrived', 'in_trip', 'busy'].includes(d.status)
    ).length

    const humanDrivers = fleet.filter((d) => d.type === 'human').length
    const avs = fleet.filter((d) => d.type === 'av').length
    const available = fleet.filter((d) =>
      ['available', 'online'].includes(d.status)
    ).length

    res.json({
      active,
      drivers: humanDrivers,
      avs,
      available,
      dispatch_mode: DISPATCH_MODE
    })
  } catch (error) {
    console.error('ADMIN FLEET ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/fleet/locations', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('drivers')
      .select('id,name,type,status,vehicle_type,current_address,updated_at')
      .order('updated_at', { ascending: false })

    if (error) throw error

    res.json(data || [])
  } catch (error) {
    console.error('FLEET LOCATIONS ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/fleet/update-location', async (req, res) => {
  try {
    const driverId = normalizeText(req.body.driver_id)
    const currentAddressInput = normalizeText(req.body.current_address)
    const status = normalizeText(req.body.status)

    if (!driverId || !currentAddressInput) {
      return res.status(400).json({
        error: 'driver_id and current_address are required'
      })
    }

    const geo = await geocodeAddress(currentAddressInput)

    const updatePayload = {
      current_address: geo.formatted_address,
      lat: geo.lat,
      lng: geo.lng,
      updated_at: new Date().toISOString()
    }

    if (status) {
      updatePayload.status = status
    }

    const { data, error } = await supabase
      .from('drivers')
      .update(updatePayload)
      .eq('id', driverId)
      .select('*')
      .single()

    if (error) throw error

    res.json({
      success: true,
      driver: maskDriverForClient(data)
    })
  } catch (error) {
    console.error('UPDATE LOCATION ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/admin/register-driver', async (req, res) => {
  try {
    const name = normalizeText(req.body.name)
    const type = normalizeText(req.body.type || 'human')
    const status = normalizeText(req.body.status || 'available')
    const vehicle_type = normalizeText(req.body.vehicle_type || 'standard')
    const current_address_input = normalizeText(req.body.current_address)

    if (!name || !current_address_input) {
      return res.status(400).json({
        error: 'name and current_address are required'
      })
    }

    if (!['human', 'av'].includes(type)) {
      return res.status(400).json({
        error: 'type must be human or av'
      })
    }

    const geo = await geocodeAddress(current_address_input)

    const { data, error } = await supabase
      .from('drivers')
      .insert([
        {
          name,
          type,
          status,
          vehicle_type,
          current_address: geo.formatted_address,
          lat: geo.lat,
          lng: geo.lng,
          updated_at: new Date().toISOString()
        }
      ])
      .select('*')
      .single()

    if (error) throw error

    res.json({
      success: true,
      driver: maskDriverForClient(data)
    })
  } catch (error) {
    console.error('REGISTER DRIVER ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

// -------------------------
// DISPATCH FEED
// -------------------------
app.get('/api/admin/dispatch-feed', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('dispatch_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error

    res.json(data || [])
  } catch (error) {
    console.error('DISPATCH FEED ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

// -------------------------
// CHAT
// -------------------------
app.get('/api/chat', async (req, res) => {
  try {
    const rideId = normalizeText(req.query.ride_id)

    let query = supabase
      .from('ride_chat')
      .select('id,ride_id,sender_type,message,created_at')
      .order('created_at', { ascending: true })
      .limit(200)

    if (rideId) {
      query = query.eq('ride_id', rideId)
    }

    const { data, error } = await query
    if (error) throw error

    res.json(data || [])
  } catch (error) {
    console.error('GET CHAT ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/chat', async (req, res) => {
  try {
    const ride_id = normalizeText(req.body.ride_id)
    const sender_type = normalizeText(req.body.sender_type || 'rider')
    const message = normalizeText(req.body.message)

    if (!message) {
      return res.status(400).json({ error: 'message is required' })
    }

    const { data, error } = await supabase
      .from('ride_chat')
      .insert([
        {
          ride_id: ride_id || null,
          sender_type,
          message,
          created_at: new Date().toISOString()
        }
      ])
      .select('*')
      .single()

    if (error) throw error

    res.json({
      success: true,
      chat: data
    })
  } catch (error) {
    console.error('POST CHAT ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

// -------------------------
// STARTUP TEST
// -------------------------
async function startServer() {
  try {
    const { error } = await supabase.from('drivers').select('id').limit(1)

    if (error && !String(error.message || '').includes('relation')) {
      throw error
    }

    app.listen(PORT, () => {
      console.log(`Harvey Taxi Dispatch Brain running on port ${PORT}`)
      console.log(`Dispatch mode: ${DISPATCH_MODE}`)
      console.log(`AV enabled: ${AV_ENABLED}`)
      console.log(`Human drivers enabled: ${HUMAN_DRIVER_ENABLED}`)
    })
  } catch (error) {
    console.error('SERVER START ERROR:', error.message)
    process.exit(1)
  }
}

startServer()
