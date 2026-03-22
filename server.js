const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

let drivers = []
let requests = []

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function getServiceBase(type) {
  if (type === 'ride') return 5
  if (type === 'food') return 4
  if (type === 'grocery') return 6
  if (type === 'package') return 7
  return 5
}

function getServiceRate(type) {
  if (type === 'ride') return 2
  if (type === 'food') return 1.5
  if (type === 'grocery') return 2.25
  if (type === 'package') return 2.75
  return 2
}

function calculatePrice(type, distanceKm) {
  const price = getServiceBase(type) + getServiceRate(type) * distanceKm
  return Number(price).toFixed(2)
}

app.get('/estimate', (req, res) => {
  const { type, pickupLat, pickupLng, dropoffLat, dropoffLng } = req.query

  const distanceKm = getDistance(
    Number(pickupLat),
    Number(pickupLng),
    Number(dropoffLat),
    Number(dropoffLng)
  )

  const estimatedPrice = calculatePrice(type, distanceKm)

  res.json({
    type,
    distanceKm: Number(distanceKm).toFixed(2),
    estimatedPrice
  })
})

app.post('/driver/update', (req, res) => {
  const driver = req.body
  const index = drivers.findIndex(d => d.id === driver.id)

  if (index >= 0) {
    drivers[index] = { ...drivers[index], ...driver }
  } else {
    drivers.push({
      id: driver.id,
      name: driver.name || 'Harvey Driver',
      available: !!driver.available,
      services: driver.services || ['ride', 'food', 'grocery', 'package'],
      lat: driver.lat || 0,
      lng: driver.lng || 0,
      earnings: 0,
      completedJobs: 0,
      activeJobId: null
    })
  }

  res.json({ success: true })
})

app.post('/request', (req, res) => {
  const {
    type,
    riderName,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    pickupAddress,
    dropoffAddress
  } = req.body

  const distanceKm = getDistance(
    Number(pickupLat),
    Number(pickupLng),
    Number(dropoffLat),
    Number(dropoffLng)
  )

  const newRequest = {
    id: String(Date.now()),
    type,
    riderName: riderName || 'Rider',
    pickupLat: Number(pickupLat),
    pickupLng: Number(pickupLng),
    dropoffLat: Number(dropoffLat),
    dropoffLng: Number(dropoffLng),
    pickupAddress: pickupAddress || 'Pickup not entered',
    dropoffAddress: dropoffAddress || 'Dropoff not entered',
    distanceKm: Number(distanceKm).toFixed(2),
    estimatedPrice: calculatePrice(type, distanceKm),
    status: 'searching',
    createdAt: new Date().toISOString(),
    driver: null
  }

  requests.push(newRequest)

  let nearest = null
  let minDistance = Infinity

  drivers.forEach(driver => {
    if (
      driver.available &&
      !driver.activeJobId &&
      driver.services.includes(type)
    ) {
      const dist = getDistance(
        newRequest.pickupLat,
        newRequest.pickupLng,
        driver.lat,
        driver.lng
      )

      if (dist < minDistance) {
        minDistance = dist
        nearest = driver
      }
    }
  })

  if (nearest) {
    newRequest.status = 'assigned'
    newRequest.driver = {
      id: nearest.id,
      name: nearest.name || 'Harvey Driver'
    }
  }

  res.json(newRequest)
})

app.get('/request/:id', (req, res) => {
  const request = requests.find(r => r.id === req.params.id)

  if (!request) {
    return res.status(404).json({ error: 'Request not found' })
  }

  res.json(request)
})

app.get('/rider/history', (req, res) => {
  res.json(requests.slice().reverse())
})

app.get('/driver/jobs/:id', (req, res) => {
  const jobs = requests.filter(r =>
    r.driver &&
    r.driver.id === req.params.id &&
    ['assigned', 'accepted', 'in_progress'].includes(r.status)
  )

  res.json(jobs)
})

app.post('/driver/job/:jobId/accept', (req, res) => {
  const { driverId } = req.body
  const driver = drivers.find(d => d.id === driverId)
  const job = requests.find(r => r.id === req.params.jobId)

  if (!driver || !job) {
    return res.status(404).json({ error: 'Driver or job not found' })
  }

  job.status = 'accepted'
  driver.available = false
  driver.activeJobId = job.id

  res.json({ success: true, job })
})

app.post('/driver/job/:jobId/start', (req, res) => {
  const job = requests.find(r => r.id === req.params.jobId)

  if (!job) {
    return res.status(404).json({ error: 'Job not found' })
  }

  job.status = 'in_progress'
  res.json({ success: true, job })
})

app.post('/driver/job/:jobId/complete', (req, res) => {
  const { driverId } = req.body
  const driver = drivers.find(d => d.id === driverId)
  const job = requests.find(r => r.id === req.params.jobId)

  if (!driver || !job) {
    return res.status(404).json({ error: 'Driver or job not found' })
  }

  job.status = 'completed'
  driver.available = true
  driver.activeJobId = null
  driver.completedJobs = (driver.completedJobs || 0) + 1
  driver.earnings = Number(driver.earnings || 0) + Number(job.estimatedPrice || 0)

  res.json({ success: true, job })
})

app.post('/driver/job/:jobId/decline', (req, res) => {
  const { driverId } = req.body
  const job = requests.find(r => r.id === req.params.jobId)

  if (!job) {
    return res.status(404).json({ error: 'Job not found' })
  }

  job.status = 'searching'
  job.driver = null

  let nearest = null
  let minDistance = Infinity

  drivers.forEach(d => {
    if (
      d.id !== driverId &&
      d.available &&
      !d.activeJobId &&
      d.services.includes(job.type)
    ) {
      const dist = getDistance(job.pickupLat, job.pickupLng, d.lat, d.lng)
      if (dist < minDistance) {
        minDistance = dist
        nearest = d
      }
    }
  })

  if (nearest) {
    job.status = 'assigned'
    job.driver = {
      id: nearest.id,
      name: nearest.name || 'Harvey Driver'
    }
  }

  res.json({ success: true, job })
})

app.get('/driver/stats/:id', (req, res) => {
  const driver = drivers.find(d => d.id === req.params.id)

  if (!driver) {
    return res.json({
      earnings: '0.00',
      completedJobs: 0,
      activeJobId: null
    })
  }

  res.json({
    earnings: Number(driver.earnings || 0).toFixed(2),
    completedJobs: driver.completedJobs || 0,
    activeJobId: driver.activeJobId || null
  })
})

app.get('/admin/overview', (req, res) => {
  res.json({
    drivers,
    requests: requests.slice().reverse()
  })
})

app.listen(PORT, () => {
  console.log('SUPER APP LIVE ' + PORT)
})
