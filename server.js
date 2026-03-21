const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public')))

// ===============================
// SAFE ADMIN CONFIG
// ===============================
const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL ||
  'admin@harveytaxi.com'

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ||
  'admin123'

const ADMIN_SECRET_PATH =
  process.env.ADMIN_SECRET_PATH ||
  'control-center-879'

// ===============================
// MEMORY STORAGE
// ===============================
let drivers = [
  {
    id: 'driver_1',
    name: 'Marcus Johnson',
    vehicle: 'Toyota Camry',
    plate: 'HTS-101',
    lat: 36.1627,
    lng: -86.7816,
    online: true,
    approved: true,
    serviceTypes: ['ride', 'delivery']
  },
  {
    id: 'driver_2',
    name: 'Alicia Brown',
    vehicle: 'Honda Accord',
    plate: 'HTS-202',
    lat: 36.1745,
    lng: -86.7679,
    online: true,
    approved: false,
    serviceTypes: ['ride']
  }
]

let rides = []
let deliveries = []

let users = {
  riders: [],
  drivers: [],
  admins: [
    {
      id: 'admin_1',
      name: 'Harvey Taxi Admin',
      email: ADMIN_EMAIL
    }
  ]
}

// ===============================
// HELPERS
// ===============================
function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function findNearestApprovedDriver(lat, lng, serviceType = 'ride') {
  let nearest = null
  let shortest = Infinity

  drivers.forEach((driver) => {
    const supportsService =
      !driver.serviceTypes || driver.serviceTypes.includes(serviceType)

    if (!driver.online || !driver.approved || !supportsService) return

    const distance = getDistance(lat, lng, driver.lat, driver.lng)

    if (distance < shortest) {
      shortest = distance
      nearest = driver
    }
  })

  return nearest
}

function escapeHtml(text) {
  if (text === undefined || text === null) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function dashboardPage() {
  const onlineDrivers = drivers.filter((d) => d.online).length
  const approvedDrivers = drivers.filter((d) => d.approved).length
  const pendingDrivers = drivers.filter((d) => !d.approved).length
  const activeRides = rides.filter((r) => r.status !== 'completed').length
  const activeDeliveries = deliveries.filter((d) => d.status !== 'completed').length

  const driversRows = drivers.length
    ? drivers
        .map(
          (driver) => `
          <tr>
            <td>${escapeHtml(driver.id)}</td>
            <td>${escapeHtml(driver.name)}</td>
            <td>${escapeHtml(driver.vehicle || '-')}</td>
            <td>${escapeHtml(driver.plate || '-')}</td>
            <td>${driver.online ? 'Online' : 'Offline'}</td>
            <td>${driver.approved ? 'Approved' : 'Pending'}</td>
            <td>${escapeHtml((driver.serviceTypes || []).join(', ') || 'ride')}</td>
            <td style="display:flex;gap:8px;flex-wrap:wrap;">
              ${
                driver.approved
                  ? `<button onclick="deactivateDriver('${driver.id}')">Deactivate</button>`
                  : `<button onclick="approveDriver('${driver.id}')">Approve</button>`
              }
            </td>
          </tr>
        `
        )
        .join('')
    : `
      <tr>
        <td colspan="8">No drivers yet</td>
      </tr>
    `

  const ridesRows = rides.length
    ? rides
        .slice()
        .reverse()
        .map(
          (ride) => `
          <tr>
            <td>${escapeHtml(ride.id)}</td>
            <td>${escapeHtml(ride.riderId || '-')}</td>
            <td>${escapeHtml(ride.pickup || '-')}</td>
            <td>${escapeHtml(ride.dropoff || '-')}</td>
            <td>${escapeHtml(ride.driver?.name || 'Unassigned')}</td>
            <td>${escapeHtml(ride.service || 'ride')}</td>
            <td>${escapeHtml(ride.status)}</td>
            <td>
              ${
                ride.status !== 'completed'
                  ? `<button onclick="completeRide('${ride.id}')">Complete</button>`
                  : 'Done'
              }
            </td>
          </tr>
        `
        )
        .join('')
    : `
      <tr>
        <td colspan="8">No rides yet</td>
      </tr>
    `

  const deliveriesRows = deliveries.length
    ? deliveries
        .slice()
        .reverse()
        .map(
          (delivery) => `
          <tr>
            <td>${escapeHtml(delivery.id)}</td>
            <td>${escapeHtml(delivery.item || '-')}</td>
            <td>${escapeHtml(delivery.pickup || '-')}</td>
            <td>${escapeHtml(delivery.dropoff || '-')}</td>
            <td>${escapeHtml(delivery.driver?.name || 'Unassigned')}</td>
            <td>${escapeHtml(delivery.status)}</td>
            <td>
              ${
                delivery.status !== 'completed'
                  ? `<button onclick="completeDelivery('${delivery.id}')">Complete</button>`
                  : 'Done'
              }
            </td>
          </tr>
        `
        )
        .join('')
    : `
      <tr>
        <td colspan="7">No deliveries yet</td>
      </tr>
    `

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Harvey Taxi Admin Dashboard</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Arial, sans-serif;
        background: #0f172a;
        color: #fff;
      }
      .wrap {
        max-width: 1400px;
        margin: 0 auto;
        padding: 20px;
      }
      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 20px;
      }
      .brand {
        font-size: 28px;
        font-weight: 800;
      }
      .sub {
        color: #cbd5e1;
        margin-top: 6px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
        margin-bottom: 24px;
      }
      .card {
        background: #111827;
        border: 1px solid #1f2937;
        border-radius: 18px;
        padding: 18px;
        box-shadow: 0 10px 30px rgba(0,0,0,.25);
      }
      .card h3 {
        margin: 0 0 8px 0;
        color: #cbd5e1;
        font-size: 15px;
      }
      .card .big {
        font-size: 34px;
        font-weight: 800;
      }
      .section {
        background: #111827;
        border: 1px solid #1f2937;
        border-radius: 18px;
        padding: 18px;
        margin-bottom: 18px;
        overflow: hidden;
      }
      .section h2 {
        margin: 0 0 14px 0;
        font-size: 22px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        min-width: 900px;
      }
      th, td {
        padding: 12px;
        border-bottom: 1px solid #243041;
        text-align: left;
        font-size: 14px;
      }
      th {
        color: #93c5fd;
      }
      .table-wrap {
        overflow-x: auto;
      }
      button, .refresh-btn {
        background: #22c55e;
        color: #081018;
        border: none;
        padding: 10px 14px;
        border-radius: 10px;
        font-weight: 700;
        cursor: pointer;
      }
      .refresh-btn {
        text-decoration: none;
        display: inline-block;
      }
      .danger {
        background: #ef4444;
        color: white;
      }
      .muted {
        color: #94a3b8;
      }
      .login-box {
        max-width: 430px;
        margin: 90px auto;
        background: #111827;
        border: 1px solid #1f2937;
        border-radius: 20px;
        padding: 22px;
      }
      input {
        width: 100%;
        padding: 14px;
        border-radius: 12px;
        border: 1px solid #334155;
        background: #0f172a;
        color: white;
        margin-bottom: 12px;
      }
      .footer-note {
        margin-top: 8px;
        color: #94a3b8;
        font-size: 13px;
      }
      @media (max-width: 700px) {
        .brand { font-size: 22px; }
        .card .big { font-size: 28px; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="topbar">
        <div>
          <div class="brand">Harvey Taxi Admin Dashboard</div>
          <div class="sub">Control center for rides, deliveries, and drivers</div>
        </div>
        <a class="refresh-btn" href="/${ADMIN_SECRET_PATH}">Refresh</a>
      </div>

      <div class="grid">
        <div class="card">
          <h3>Total Drivers</h3>
          <div class="big">${drivers.length}</div>
        </div>
        <div class="card">
          <h3>Online Drivers</h3>
          <div class="big">${onlineDrivers}</div>
        </div>
        <div class="card">
          <h3>Approved Drivers</h3>
          <div class="big">${approvedDrivers}</div>
        </div>
        <div class="card">
          <h3>Pending Drivers</h3>
          <div class="big">${pendingDrivers}</div>
        </div>
        <div class="card">
          <h3>Total Rides</h3>
          <div class="big">${rides.length}</div>
        </div>
        <div class="card">
          <h3>Active Rides</h3>
          <div class="big">${activeRides}</div>
        </div>
        <div class="card">
          <h3>Total Deliveries</h3>
          <div class="big">${deliveries.length}</div>
        </div>
        <div class="card">
          <h3>Active Deliveries</h3>
          <div class="big">${activeDeliveries}</div>
        </div>
      </div>

      <div class="section">
        <h2>Drivers</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Vehicle</th>
                <th>Plate</th>
                <th>Status</th>
                <th>Approval</th>
                <th>Services</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${driversRows}
            </tbody>
          </table>
        </div>
      </div>

      <div class="section">
        <h2>Rides</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Rider ID</th>
                <th>Pickup</th>
                <th>Dropoff</th>
                <th>Driver</th>
                <th>Service</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${ridesRows}
            </tbody>
          </table>
        </div>
      </div>

      <div class="section">
        <h2>Deliveries</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Item</th>
                <th>Pickup</th>
                <th>Dropoff</th>
                <th>Driver</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${deliveriesRows}
            </tbody>
          </table>
        </div>
      </div>

      <div class="footer-note">
        Hidden route active: /${ADMIN_SECRET_PATH}
      </div>
    </div>

    <script>
      async function approveDriver(driverId) {
        const res = await fetch('/admin/driver/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId })
        })
        const data = await res.json()
        alert(data.message || 'Updated')
        location.reload()
      }

      async function deactivateDriver(driverId) {
        const res = await fetch('/admin/driver/deactivate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId })
        })
        const data = await res.json()
        alert(data.message || 'Updated')
        location.reload()
      }

      async function completeRide(rideId) {
        const res = await fetch('/admin/ride/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rideId })
        })
        const data = await res.json()
        alert(data.message || 'Ride updated')
        location.reload()
      }

      async function completeDelivery(deliveryId) {
        const res = await fetch('/admin/delivery/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deliveryId })
        })
        const data = await res.json()
        alert(data.message || 'Delivery updated')
        location.reload()
      }
    </script>
  </body>
  </html>
  `
}

function adminLoginPage(message = '') {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Harvey Taxi Admin Login</title>
    <style>
      body {
        margin: 0;
        font-family: Arial, sans-serif;
        background: #020617;
        color: white;
      }
      .login-box {
        max-width: 430px;
        margin: 100px auto;
        background: #111827;
        border: 1px solid #1f2937;
        border-radius: 20px;
        padding: 24px;
      }
      h1 {
        margin-top: 0;
        font-size: 28px;
      }
      p {
        color: #cbd5e1;
      }
      input {
        width: 100%;
        padding: 14px;
        border-radius: 12px;
        border: 1px solid #334155;
        background: #0f172a;
        color: white;
        margin-bottom: 12px;
        box-sizing: border-box;
      }
      button {
        width: 100%;
        padding: 14px;
        border-radius: 12px;
        border: none;
        font-weight: 800;
        background: #22c55e;
        cursor: pointer;
      }
      .msg {
        color: #fca5a5;
        margin-bottom: 10px;
      }
    </style>
  </head>
  <body>
    <div class="login-box">
      <h1>Admin Login</h1>
      <p>Harvey Taxi secure control center</p>
      ${message ? `<div class="msg">${escapeHtml(message)}</div>` : ''}
      <form method="POST" action="/admin/login-page">
        <input type="email" name="email" placeholder="Admin Email" required />
        <input type="password" name="password" placeholder="Password" required />
        <button type="submit">Login</button>
      </form>
    </div>
  </body>
  </html>
  `
}

// ===============================
// BASIC ROUTES
// ===============================
app.get('/health', (req, res) => {
  res.json({ status: 'Harvey Taxi API Running' })
})

app.get('/drivers', (req, res) => {
  res.json(drivers)
})

app.get('/rides', (req, res) => {
  res.json(rides)
})

app.get('/deliveries', (req, res) => {
  res.json(deliveries)
})

// ===============================
// DRIVER ROUTES
// ===============================
app.post('/driver/update', (req, res) => {
  const { id, lat, lng, name, vehicle, plate, serviceTypes } = req.body

  if (!id) {
    return res.status(400).json({
      success: false,
      message: 'Driver id is required'
    })
  }

  let driver = drivers.find((d) => d.id === id)

  if (driver) {
    driver.lat = lat ?? driver.lat
    driver.lng = lng ?? driver.lng
    driver.name = name || driver.name
    driver.vehicle = vehicle || driver.vehicle
    driver.plate = plate || driver.plate
    driver.online = true
    if (Array.isArray(serviceTypes)) {
      driver.serviceTypes = serviceTypes
    }
  } else {
    driver = {
      id,
      name: name || 'New Driver',
      vehicle: vehicle || 'Unknown Vehicle',
      plate: plate || '',
      lat: lat || 0,
      lng: lng || 0,
      online: true,
      approved: false,
      serviceTypes: Array.isArray(serviceTypes) ? serviceTypes : ['ride']
    }
    drivers.push(driver)
  }

  res.json({
    success: true,
    message: 'Driver updated',
    driver
  })
})

// ===============================
// RIDE REQUEST
// ===============================
app.post('/request-ride', (req, res) => {
  const { riderId, pickup, dropoff, lat, lng, service } = req.body

  const nearest = findNearestApprovedDriver(lat, lng, service || 'ride')

  if (!nearest) {
    return res.json({
      success: false,
      message: 'No approved drivers available'
    })
  }

  const ride = {
    id: 'ride_' + Date.now(),
    riderId: riderId || 'guest_rider',
    pickup: pickup || 'Unknown Pickup',
    dropoff: dropoff || 'Unknown Dropoff',
    lat: lat || 0,
    lng: lng || 0,
    service: service || 'ride',
    driver: nearest,
    status: 'assigned',
    createdAt: new Date().toISOString()
  }

  rides.push(ride)

  res.json({
    success: true,
    message: 'Ride assigned successfully',
    ride
  })
})

// ===============================
// DELIVERY REQUEST
// ===============================
app.post('/request-delivery', (req, res) => {
  const { pickup, dropoff, item, lat, lng } = req.body

  const nearest = findNearestApprovedDriver(lat, lng, 'delivery')

  const delivery = {
    id: 'delivery_' + Date.now(),
    pickup: pickup || 'Unknown Pickup',
    dropoff: dropoff || 'Unknown Dropoff',
    item: item || 'Package',
    lat: lat || 0,
    lng: lng || 0,
    driver: nearest || null,
    status: nearest ? 'assigned' : 'pending',
    createdAt: new Date().toISOString()
  }

  deliveries.push(delivery)

  res.json({
    success: true,
    message: nearest
      ? 'Delivery assigned successfully'
      : 'Delivery created and waiting for driver',
    delivery
  })
})

// ===============================
// ADMIN API LOGIN
// ===============================
app.post('/admin/login', (req, res) => {
  const { email, password } = req.body

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    return res.json({
      success: true,
      message: 'Admin login successful',
      adminPath: `/${ADMIN_SECRET_PATH}`
    })
  }

  return res.status(401).json({
    success: false,
    message: 'Invalid admin login'
  })
})

// ===============================
// ADMIN LOGIN PAGE
// ===============================
app.get('/admin', (req, res) => {
  res.send(adminLoginPage())
})

app.post('/admin/login-page', (req, res) => {
  const { email, password } = req.body

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    return res.redirect(`/${ADMIN_SECRET_PATH}`)
  }

  return res.send(adminLoginPage('Invalid admin email or password'))
})

// ===============================
// SECRET ADMIN DASHBOARD
// ===============================
app.get(`/${ADMIN_SECRET_PATH}`, (req, res) => {
  res.send(dashboardPage())
})

// ===============================
// ADMIN ACTIONS
// ===============================
app.get('/admin/data', (req, res) => {
  res.json({
    success: true,
    stats: {
      drivers: drivers.length,
      onlineDrivers: drivers.filter((d) => d.online).length,
      approvedDrivers: drivers.filter((d) => d.approved).length,
      rides: rides.length,
      deliveries: deliveries.length
    },
    drivers,
    rides,
    deliveries,
    users
  })
})

app.post('/admin/driver/approve', (req, res) => {
  const { driverId } = req.body
  const driver = drivers.find((d) => d.id === driverId)

  if (!driver) {
    return res.status(404).json({
      success: false,
      message: 'Driver not found'
    })
  }

  driver.approved = true

  res.json({
    success: true,
    message: `${driver.name} approved successfully`
  })
})

app.post('/admin/driver/deactivate', (req, res) => {
  const { driverId } = req.body
  const driver = drivers.find((d) => d.id === driverId)

  if (!driver) {
    return res.status(404).json({
      success: false,
      message: 'Driver not found'
    })
  }

  driver.approved = false
  driver.online = false

  res.json({
    success: true,
    message: `${driver.name} deactivated successfully`
  })
})

app.post('/admin/ride/complete', (req, res) => {
  const { rideId } = req.body
  const ride = rides.find((r) => r.id === rideId)

  if (!ride) {
    return res.status(404).json({
      success: false,
      message: 'Ride not found'
    })
  }

  ride.status = 'completed'

  res.json({
    success: true,
    message: 'Ride marked completed'
  })
})

app.post('/admin/delivery/complete', (req, res) => {
  const { deliveryId } = req.body
  const delivery = deliveries.find((d) => d.id === deliveryId)

  if (!delivery) {
    return res.status(404).json({
      success: false,
      message: 'Delivery not found'
    })
  }

  delivery.status = 'completed'

  res.json({
    success: true,
    message: 'Delivery marked completed'
  })
})

// ===============================
// ROOT
// ===============================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => {
  console.log('Harvey Taxi Server Running on port ' + PORT)
  console.log('Admin route: /' + ADMIN_SECRET_PATH)
})
