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

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const DISPATCH_MODE = process.env.DISPATCH_MODE || 'mixed'
const AV_ENABLED = String(process.env.AV_ENABLED || 'true') === 'true'
const HUMAN_DRIVER_ENABLED = String(process.env.HUMAN_DRIVER_ENABLED || 'true') === 'true'
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || ''

const RIDE_STATUSES = {
  REQUESTED: 'requested',
  ASSIGNED: 'assigned',
  ACCEPTED: 'accepted',
  ARRIVING: 'arriving',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
}

function normalize(value) {
  return String(value || '').trim()
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

function sanitizeRide(ride) {
  if (!ride) return null

  return {
    id: ride.id,
    rider_name: ride.rider_name,
    rider_phone: ride.rider_phone || null,
    rider_id: ride.rider_id || null,
    pickup_address: ride.pickup_address,
    dropoff_address: ride.dropoff_address,
    driver_id: ride.driver_id || null,
    driver_name: ride.driver_name || null,
    fleet_type: ride.fleet_type || null,
    vehicle_type: ride.vehicle_type || null,
    status: ride.status,
    admin_override: !!ride.admin_override,
    estimated_fare: ride.estimated_fare || null,
    created_at: ride.created_at || null,
    assigned_at: ride.assigned_at || null,
    accepted_at: ride.accepted_at || null,
    arriving_at: ride.arriving_at || null,
    started_at: ride.started_at || null,
    completed_at: ride.completed_at || null,
    cancelled_at: ride.cancelled_at || null
  }
}

function sanitizeDriver(driver) {
  if (!driver) return null

  return {
    id: driver.id,
    name: driver.name,
    phone: driver.phone || null,
    type: driver.type,
    status: driver.status,
    vehicle_type: driver.vehicle_type || null,
    current_address: driver.current_address || null,
    updated_at: driver.updated_at || null
  }
}

async function geocodeAddress(address) {
  const safeAddress = normalize(address)

  if (!safeAddress) {
    throw new Error('Address is required')
  }

  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error('Missing GOOGLE_MAPS_API_KEY')
  }

  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?address=' +
    encodeURIComponent(safeAddress) +
    '&key=' +
    encodeURIComponent(GOOGLE_MAPS_API_KEY)

  const response = await fetch(url)
  const data = await response.json()

  if (!data.results || !data.results.length) {
    throw new Error('Geocode failed')
  }

  return {
    formatted_address: data.results[0].formatted_address,
    lat: data.results[0].geometry.location.lat,
    lng: data.results[0].geometry.location.lng
  }
}

function getPriorityScore(driverType) {
  if (DISPATCH_MODE === 'av_first') {
    return driverType === 'av' ? 1 : 2
  }

  if (DISPATCH_MODE === 'human_first') {
    return driverType === 'human' ? 1 : 2
  }

  return 1
}

async function getAvailableFleet() {
  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .in('status', ['available', 'online'])
    .order('updated_at', { ascending: false })

  if (error) throw error

  return (data || []).filter((driver) => {
    if (driver.type === 'av' && !AV_ENABLED) return false
    if (driver.type === 'human' && !HUMAN_DRIVER_ENABLED) return false
    return typeof driver.lat === 'number' && typeof driver.lng === 'number'
  })
}

async function selectBestDriverForRide(pickupLat, pickupLng, excludeDriverIds = []) {
  const fleet = await getAvailableFleet()

  const ranked = fleet
    .filter((driver) => !excludeDriverIds.includes(driver.id))
    .map((driver) => ({
      ...driver,
      distance_miles: distanceMiles(pickupLat, pickupLng, driver.lat, driver.lng),
      priority_score: getPriorityScore(driver.type)
    }))
    .sort((a, b) => {
      if (a.priority_score !== b.priority_score) {
        return a.priority_score - b.priority_score
      }
      return a.distance_miles - b.distance_miles
    })

  return ranked[0] || null
}

async function createDispatchOffer(rideId, driver) {
  const now = new Date().toISOString()

  const payload = {
    ride_id: rideId,
    driver_id: driver.id,
    driver_name: driver.name,
    fleet_type: driver.type,
    status: 'pending',
    offered_at: now,
    expires_at: new Date(Date.now() + 1000 * 60 * 3).toISOString()
  }

  const { error } = await supabase.from('dispatch_offers').insert([payload])

  if (error) {
    console.log('Dispatch offer note:', error.message)
  }
}

async function updateDriverStatus(driverId, status) {
  const { error } = await supabase
    .from('drivers')
    .update({
      status,
      updated_at: new Date().toISOString()
    })
    .eq('id', driverId)

  if (error) throw error
}

async function clearPendingOffersForRide(rideId) {
  const { error } = await supabase
    .from('dispatch_offers')
    .update({
      status: 'expired',
      responded_at: new Date().toISOString()
    })
    .eq('ride_id', rideId)
    .eq('status', 'pending')

  if (error) {
    console.log('Offer cleanup note:', error.message)
  }
}

async function assignRideToDriver({ ride, driver, adminOverride = false }) {
  const now = new Date().toISOString()

  await updateDriverStatus(driver.id, 'assigned')

  const { data, error } = await supabase
    .from('rides')
    .update({
      driver_id: driver.id,
      driver_name: driver.name,
      fleet_type: driver.type,
      vehicle_type: driver.vehicle_type || null,
      status: RIDE_STATUSES.ASSIGNED,
      admin_override: adminOverride,
      assigned_at: now
    })
    .eq('id', ride.id)
    .select('*')
    .single()

  if (error) throw error

  await createDispatchOffer(ride.id, driver)

  const { error: queueError } = await supabase.from('dispatch_queue').upsert(
    [
      {
        ride_id: ride.id,
        assigned_driver_id: driver.id,
        pickup_address: ride.pickup_address,
        dropoff_address: ride.dropoff_address,
        fleet_type: driver.type,
        assigned: true,
        status: RIDE_STATUSES.ASSIGNED,
        updated_at: now
      }
    ],
    { onConflict: 'ride_id' }
  )

  if (queueError) {
    console.log('Dispatch queue note:', queueError.message)
  }

  return data
}

async function estimateFare(pickupLat, pickupLng, dropoffLat, dropoffLng) {
  const miles = distanceMiles(pickupLat, pickupLng, dropoffLat, dropoffLng)
  const fare = 4.5 + miles * 1.9
  return Number(fare.toFixed(2))
}

async function createRideRecord({
  rider_name,
  rider_phone,
  rider_id,
  pickup,
  dropoff
}) {
  const now = new Date().toISOString()
  const estimated_fare = await estimateFare(
    pickup.lat,
    pickup.lng,
    dropoff.lat,
    dropoff.lng
  )

  const { data, error } = await supabase
    .from('rides')
    .insert([
      {
        rider_name,
        rider_phone: rider_phone || null,
        rider_id: rider_id || null,
        pickup_address: pickup.formatted_address,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        dropoff_address: dropoff.formatted_address,
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,
        status: RIDE_STATUSES.REQUESTED,
        estimated_fare,
        created_at: now
      }
    ])
    .select('*')
    .single()

  if (error) throw error

  const { error: queueError } = await supabase.from('dispatch_queue').upsert(
    [
      {
        ride_id: data.id,
        pickup_address: data.pickup_address,
        dropoff_address: data.dropoff_address,
        assigned: false,
        status: RIDE_STATUSES.REQUESTED,
        updated_at: now
      }
    ],
    { onConflict: 'ride_id' }
  )

  if (queueError) {
    console.log('Dispatch queue note:', queueError.message)
  }

  return data
}

async function autoDispatchRide(ride) {
  const bestDriver = await selectBestDriverForRide(ride.pickup_lat, ride.pickup_lng)
  if (!bestDriver) return { ride, driver: null }

  const updatedRide = await assignRideToDriver({
    ride,
    driver: bestDriver,
    adminOverride: false
  })

  return { ride: updatedRide, driver: bestDriver }
}

async function getRideById(rideId) {
  const { data, error } = await supabase
    .from('rides')
    .select('*')
    .eq('id', rideId)
    .single()

  if (error) throw error
  return data
}

async function getDriverById(driverId) {
  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .eq('id', driverId)
    .single()

  if (error) throw error
  return data
}

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

app.get('/api/health', async (req, res) => {
  res.json({
    ok: true,
    service: 'Harvey Taxi Dispatch Brain',
    dispatch_mode: DISPATCH_MODE,
    av_enabled: AV_ENABLED,
    human_driver_enabled: HUMAN_DRIVER_ENABLED
  })
})

app.post('/api/request-ride', async (req, res) => {
  try {
    const rider_name = normalize(req.body.rider_name)
    const rider_phone = normalize(req.body.rider_phone)
    const rider_id = normalize(req.body.rider_id)
    const pickup_input = normalize(req.body.pickup_address)
    const dropoff_input = normalize(req.body.dropoff_address)

    if (!rider_name || !pickup_input || !dropoff_input) {
      return res.status(400).json({
        error: 'rider_name, pickup_address, and dropoff_address are required'
      })
    }

    const pickup = await geocodeAddress(pickup_input)
    const dropoff = await geocodeAddress(dropoff_input)

    const ride = await createRideRecord({
      rider_name,
      rider_phone,
      rider_id,
      pickup,
      dropoff
    })

    const dispatched = await autoDispatchRide(ride)

    if (!dispatched.driver) {
      return res.json({
        success: true,
        message: 'Ride created and waiting for assignment',
        ride: sanitizeRide(ride),
        assigned_driver: null
      })
    }

    res.json({
      success: true,
      message: 'Ride created and auto-dispatched',
      ride: sanitizeRide(dispatched.ride),
      assigned_driver: sanitizeDriver(dispatched.driver)
    })
  } catch (error) {
    console.error('REQUEST RIDE ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

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
    const ride = await getRideById(rideId)
    res.json(sanitizeRide(ride))
  } catch (error) {
    console.error('GET RIDE ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/rider/live-trip/:rideId', async (req, res) => {
  try {
    const { rideId } = req.params
    const ride = await getRideById(rideId)

    let driver = null

    if (ride.driver_id) {
      const d = await getDriverById(ride.driver_id)
      driver = sanitizeDriver(d)
    }

    res.json({
      ride: sanitizeRide(ride),
      driver
    })
  } catch (error) {
    console.error('RIDER LIVE TRIP ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/driver/offers/:driverId', async (req, res) => {
  try {
    const driverId = normalize(req.params.driverId)

    const { data, error } = await supabase
      .from('dispatch_offers')
      .select('*')
      .eq('driver_id', driverId)
      .in('status', ['pending'])
      .order('offered_at', { ascending: false })

    if (error) throw error

    if (!data || !data.length) {
      return res.json([])
    }

    const rideIds = data.map((offer) => offer.ride_id)

    const { data: rides, error: rideError } = await supabase
      .from('rides')
      .select('*')
      .in('id', rideIds)

    if (rideError) throw rideError

    const rideMap = {}
    ;(rides || []).forEach((r) => {
      rideMap[r.id] = r
    })

    const result = data.map((offer) => ({
      ...offer,
      ride: sanitizeRide(rideMap[offer.ride_id])
    }))

    res.json(result)
  } catch (error) {
    console.error('DRIVER OFFERS ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/driver/offers/:offerId/accept', async (req, res) => {
  try {
    const offerId = normalize(req.params.offerId)
    const now = new Date().toISOString()

    const { data: offer, error: offerError } = await supabase
      .from('dispatch_offers')
      .select('*')
      .eq('id', offerId)
      .single()

    if (offerError) throw offerError

    const ride = await getRideById(offer.ride_id)

    await supabase
      .from('dispatch_offers')
      .update({ status: 'accepted', responded_at: now })
      .eq('id', offerId)

    await supabase
      .from('dispatch_offers')
      .update({ status: 'expired', responded_at: now })
      .eq('ride_id', offer.ride_id)
      .neq('id', offerId)
      .eq('status', 'pending')

    await updateDriverStatus(offer.driver_id, 'busy')

    const { data: updatedRide, error: updateError } = await supabase
      .from('rides')
      .update({
        status: RIDE_STATUSES.ACCEPTED,
        accepted_at: now
      })
      .eq('id', offer.ride_id)
      .select('*')
      .single()

    if (updateError) throw updateError

    await supabase
      .from('dispatch_queue')
      .update({
        status: RIDE_STATUSES.ACCEPTED,
        updated_at: now
      })
      .eq('ride_id', ride.id)

    res.json({
      success: true,
      ride: sanitizeRide(updatedRide)
    })
  } catch (error) {
    console.error('ACCEPT OFFER ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/driver/offers/:offerId/decline', async (req, res) => {
  try {
    const offerId = normalize(req.params.offerId)
    const now = new Date().toISOString()

    const { data: offer, error: offerError } = await supabase
      .from('dispatch_offers')
      .select('*')
      .eq('id', offerId)
      .single()

    if (offerError) throw offerError

    await supabase
      .from('dispatch_offers')
      .update({
        status: 'declined',
        responded_at: now
      })
      .eq('id', offerId)

    await updateDriverStatus(offer.driver_id, 'available')

    const ride = await getRideById(offer.ride_id)

    const { data: previousOffers } = await supabase
      .from('dispatch_offers')
      .select('driver_id')
      .eq('ride_id', ride.id)

    const excludeDriverIds = (previousOffers || []).map((x) => x.driver_id)

    const nextDriver = await selectBestDriverForRide(
      ride.pickup_lat,
      ride.pickup_lng,
      excludeDriverIds
    )

    if (nextDriver) {
      const updatedRide = await assignRideToDriver({
        ride,
        driver: nextDriver,
        adminOverride: false
      })

      return res.json({
        success: true,
        message: 'Offer declined, ride reassigned',
        ride: sanitizeRide(updatedRide),
        reassigned_driver: sanitizeDriver(nextDriver)
      })
    }

    const { data: waitingRide, error: waitingError } = await supabase
      .from('rides')
      .update({
        driver_id: null,
        driver_name: null,
        fleet_type: null,
        vehicle_type: null,
        status: RIDE_STATUSES.REQUESTED
      })
      .eq('id', ride.id)
      .select('*')
      .single()

    if (waitingError) throw waitingError

    await supabase
      .from('dispatch_queue')
      .update({
        assigned: false,
        assigned_driver_id: null,
        fleet_type: null,
        status: RIDE_STATUSES.REQUESTED,
        updated_at: now
      })
      .eq('ride_id', ride.id)

    res.json({
      success: true,
      message: 'Offer declined, ride returned to waiting queue',
      ride: sanitizeRide(waitingRide)
    })
  } catch (error) {
    console.error('DECLINE OFFER ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/driver/rides/:rideId/status', async (req, res) => {
  try {
    const rideId = normalize(req.params.rideId)
    const status = normalize(req.body.status)
    const now = new Date().toISOString()

    const allowed = [
      RIDE_STATUSES.ACCEPTED,
      RIDE_STATUSES.ARRIVING,
      RIDE_STATUSES.IN_PROGRESS,
      RIDE_STATUSES.COMPLETED,
      RIDE_STATUSES.CANCELLED
    ]

    if (!allowed.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' })
    }

    const ride = await getRideById(rideId)

    const patch = { status }

    if (status === RIDE_STATUSES.ARRIVING) patch.arriving_at = now
    if (status === RIDE_STATUSES.IN_PROGRESS) patch.started_at = now
    if (status === RIDE_STATUSES.COMPLETED) patch.completed_at = now
    if (status === RIDE_STATUSES.CANCELLED) patch.cancelled_at = now

    const { data: updatedRide, error } = await supabase
      .from('rides')
      .update(patch)
      .eq('id', rideId)
      .select('*')
      .single()

    if (error) throw error

    await supabase
      .from('dispatch_queue')
      .update({
        status,
        updated_at: now
      })
      .eq('ride_id', rideId)

    if (status === RIDE_STATUSES.COMPLETED || status === RIDE_STATUSES.CANCELLED) {
      if (ride.driver_id) {
        await updateDriverStatus(ride.driver_id, 'available')
      }
    }

    res.json({
      success: true,
      ride: sanitizeRide(updatedRide)
    })
  } catch (error) {
    console.error('DRIVER RIDE STATUS ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/admin/assign-ride', async (req, res) => {
  try {
    const rideId = normalize(req.body.ride_id)
    const driverId = normalize(req.body.driver_id)

    if (!rideId || !driverId) {
      return res.status(400).json({ error: 'ride_id and driver_id are required' })
    }

    const ride = await getRideById(rideId)
    const driver = await getDriverById(driverId)

    await clearPendingOffersForRide(ride.id)

    const updatedRide = await assignRideToDriver({
      ride,
      driver,
      adminOverride: true
    })

    res.json({
      success: true,
      message: 'Ride assigned by admin',
      ride: sanitizeRide(updatedRide),
      driver: sanitizeDriver(driver)
    })
  } catch (error) {
    console.error('ADMIN ASSIGN ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/admin/reassign-ride', async (req, res) => {
  try {
    const rideId = normalize(req.body.ride_id)
    const driverId = normalize(req.body.driver_id)
    const now = new Date().toISOString()

    if (!rideId || !driverId) {
      return res.status(400).json({ error: 'ride_id and driver_id are required' })
    }

    const ride = await getRideById(rideId)

    if (ride.driver_id) {
      await updateDriverStatus(ride.driver_id, 'available')
    }

    await clearPendingOffersForRide(ride.id)

    const driver = await getDriverById(driverId)

    const { data: updatedRide, error } = await supabase
      .from('rides')
      .update({
        driver_id: driver.id,
        driver_name: driver.name,
        fleet_type: driver.type,
        vehicle_type: driver.vehicle_type || null,
        status: RIDE_STATUSES.ASSIGNED,
        admin_override: true,
        assigned_at: now
      })
      .eq('id', ride.id)
      .select('*')
      .single()

    if (error) throw error

    await updateDriverStatus(driver.id, 'assigned')
    await createDispatchOffer(ride.id, driver)

    await supabase
      .from('dispatch_queue')
      .update({
        assigned: true,
        assigned_driver_id: driver.id,
        fleet_type: driver.type,
        status: RIDE_STATUSES.ASSIGNED,
        updated_at: now
      })
      .eq('ride_id', ride.id)

    res.json({
      success: true,
      message: 'Ride reassigned by admin',
      ride: sanitizeRide(updatedRide),
      driver: sanitizeDriver(driver)
    })
  } catch (error) {
    console.error('ADMIN REASSIGN ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/admin/cancel-ride', async (req, res) => {
  try {
    const rideId = normalize(req.body.ride_id)
    const now = new Date().toISOString()

    if (!rideId) {
      return res.status(400).json({ error: 'ride_id is required' })
    }

    const ride = await getRideById(rideId)

    if (ride.driver_id) {
      await updateDriverStatus(ride.driver_id, 'available')
    }

    await clearPendingOffersForRide(ride.id)

    const { data: updatedRide, error } = await supabase
      .from('rides')
      .update({
        status: RIDE_STATUSES.CANCELLED,
        cancelled_at: now
      })
      .eq('id', rideId)
      .select('*')
      .single()

    if (error) throw error

    await supabase
      .from('dispatch_queue')
      .update({
        status: RIDE_STATUSES.CANCELLED,
        updated_at: now
      })
      .eq('ride_id', rideId)

    res.json({
      success: true,
      message: 'Ride cancelled by admin',
      ride: sanitizeRide(updatedRide)
    })
  } catch (error) {
    console.error('ADMIN CANCEL ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/admin/dispatch-feed', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('dispatch_queue')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(100)

    if (error) throw error

    res.json(data || [])
  } catch (error) {
    console.error('DISPATCH FEED ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/admin/fleet', async (req, res) => {
  try {
    const { data, error } = await supabase.from('drivers').select('*')
    if (error) throw error

    const fleet = data || []

    res.json({
      active: fleet.filter((x) =>
        ['assigned', 'busy', 'arriving', 'in_progress'].includes(x.status)
      ).length,
      drivers: fleet.filter((x) => x.type === 'human').length,
      avs: fleet.filter((x) => x.type === 'av').length,
      available: fleet.filter((x) => ['available', 'online'].includes(x.status)).length,
      fleet: fleet.map(sanitizeDriver)
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
      .select('id,name,phone,type,status,vehicle_type,current_address,updated_at')
      .order('updated_at', { ascending: false })

    if (error) throw error

    res.json((data || []).map(sanitizeDriver))
  } catch (error) {
    console.error('FLEET LOCATIONS ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/fleet/update-location', async (req, res) => {
  try {
    const driverId = normalize(req.body.driver_id)
    const currentAddressInput = normalize(req.body.current_address)
    const status = normalize(req.body.status)

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
      driver: sanitizeDriver(data)
    })
  } catch (error) {
    console.error('UPDATE LOCATION ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/admin/register-driver', async (req, res) => {
  try {
    const name = normalize(req.body.name)
    const phone = normalize(req.body.phone)
    const type = normalize(req.body.type || 'human')
    const status = normalize(req.body.status || 'available')
    const vehicle_type = normalize(req.body.vehicle_type || 'standard')
    const current_address_input = normalize(req.body.current_address)

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
          phone: phone || null,
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
      driver: sanitizeDriver(data)
    })
  } catch (error) {
    console.error('REGISTER DRIVER ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/chat', async (req, res) => {
  try {
    const rideId = normalize(req.query.ride_id)

    let query = supabase
      .from('ride_chat')
      .select('*')
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
    const ride_id = normalize(req.body.ride_id)
    const sender_type = normalize(req.body.sender_type || 'rider')
    const message = normalize(req.body.message)

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

app.listen(PORT, () => {
  console.log(`Harvey Taxi Dispatch Brain running on port ${PORT}`)
})
