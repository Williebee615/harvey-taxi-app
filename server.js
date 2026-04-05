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

async function geocodeAddress(address) {
  const safeAddress = normalize(address)

  if (!safeAddress) {
    throw new Error('Address is required')
  }

  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?address=' +
    encodeURIComponent(safeAddress) +
    '&key=' +
    encodeURIComponent(process.env.GOOGLE_MAPS_API_KEY)

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

app.get('/api/health', (req, res) => {
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
    const riderName = normalize(req.body.rider_name)
    const pickupInput = normalize(req.body.pickup_address)
    const dropoffInput = normalize(req.body.dropoff_address)

    if (!riderName || !pickupInput || !dropoffInput) {
      return res.status(400).json({
        error: 'rider_name, pickup_address, and dropoff_address are required'
      })
    }

    const pickup = await geocodeAddress(pickupInput)
    const dropoff = await geocodeAddress(dropoffInput)

    const { data: drivers, error: driverError } = await supabase
      .from('drivers')
      .select('*')
      .in('status', ['available', 'online'])

    if (driverError) throw driverError

    const availableDrivers = (drivers || []).filter((d) => {
      if (d.type === 'av' && !AV_ENABLED) return false
      if (d.type === 'human' && !HUMAN_DRIVER_ENABLED) return false
      return typeof d.lat === 'number' && typeof d.lng === 'number'
    })

    const rankedDrivers = availableDrivers
      .map((driver) => ({
        ...driver,
        distance_miles: distanceMiles(pickup.lat, pickup.lng, driver.lat, driver.lng)
      }))
      .sort((a, b) => a.distance_miles - b.distance_miles)

    const selectedDriver = rankedDrivers[0]

    if (!selectedDriver) {
      await supabase.from('dispatch_queue').insert([
        {
          pickup_address: pickup.formatted_address,
          dropoff_address: dropoff.formatted_address,
          assigned: false,
          fleet_type: 'unassigned',
          status: 'waiting'
        }
      ])

      return res.status(404).json({
        error: 'No available drivers or AVs found'
      })
    }

    const { error: lockError } = await supabase
      .from('drivers')
      .update({ status: 'assigned' })
      .eq('id', selectedDriver.id)

    if (lockError) throw lockError

    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .insert([
        {
          rider_name: riderName,
          pickup_address: pickup.formatted_address,
          pickup_lat: pickup.lat,
          pickup_lng: pickup.lng,
          dropoff_address: dropoff.formatted_address,
          dropoff_lat: dropoff.lat,
          dropoff_lng: dropoff.lng,
          driver_id: selectedDriver.id,
          vehicle_type: selectedDriver.vehicle_type || null,
          fleet_type: selectedDriver.type,
          status: 'assigned',
          dispatch_mode: DISPATCH_MODE
        }
      ])
      .select()
      .single()

    if (rideError) throw rideError

    await supabase.from('dispatch_queue').insert([
      {
        ride_id: ride.id,
        pickup_address: pickup.formatted_address,
        dropoff_address: dropoff.formatted_address,
        assigned: true,
        assigned_driver_id: selectedDriver.id,
        fleet_type: selectedDriver.type,
        status: 'assigned'
      }
    ])

    res.json({
      success: true,
      ride,
      assigned_unit: {
        id: selectedDriver.id,
        name: selectedDriver.name,
        type: selectedDriver.type,
        vehicle_type: selectedDriver.vehicle_type,
        current_address: selectedDriver.current_address,
        distance_miles: Number(selectedDriver.distance_miles.toFixed(2))
      }
    })
  } catch (error) {
    console.error('REQUEST RIDE ERROR:', error.message)
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
        ['assigned', 'enroute', 'arrived', 'in_trip', 'busy'].includes(x.status)
      ).length,
      drivers: fleet.filter((x) => x.type === 'human').length,
      avs: fleet.filter((x) => x.type === 'av').length,
      available: fleet.filter((x) => ['available', 'online'].includes(x.status)).length
    })
  } catch (error) {
    console.error('ADMIN FLEET ERROR:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.listen(PORT, () => {
  console.log(`Harvey Dispatch Brain running on port ${PORT}`)
})
