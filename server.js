<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Harvey Taxi Admin Panel</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: Arial, Helvetica, sans-serif;
    }

    body {
      background: linear-gradient(180deg, #06112d 0%, #081735 45%, #091a3f 100%);
      color: white;
      min-height: 100vh;
    }

    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 16px 18px;
      background: rgba(8, 23, 53, 0.95);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      position: sticky;
      top: 0;
      z-index: 20;
    }

    .topbar-left h1 {
      font-size: 20px;
      font-weight: 800;
    }

    .topbar-left p {
      color: #b7c3df;
      font-size: 13px;
      margin-top: 4px;
    }

    .logout-btn {
      border: none;
      color: white;
      cursor: pointer;
      font-weight: 700;
      border-radius: 12px;
      padding: 10px 16px;
      background: linear-gradient(90deg, #2962ff 0%, #7b2cff 100%);
      box-shadow: 0 10px 25px rgba(57, 93, 255, 0.28);
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px 18px 60px;
    }

    .hero {
      margin-bottom: 28px;
    }

    .hero h2 {
      font-size: 42px;
      font-weight: 800;
      line-height: 1.08;
      margin-bottom: 12px;
    }

    .hero p {
      font-size: 18px;
      color: #aab7d8;
      line-height: 1.6;
      max-width: 760px;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(9, 1fr);
      gap: 16px;
      margin-bottom: 30px;
    }

    .summary-card {
      background: rgba(18, 30, 58, 0.94);
      border: 1px solid rgba(126, 155, 255, 0.16);
      border-radius: 20px;
      padding: 18px;
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.2);
    }

    .summary-card h3 {
      font-size: 11px;
      color: #9eb0d9;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }

    .summary-card .number {
      font-size: 24px;
      font-weight: 800;
    }

    .grid {
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: 20px;
    }

    .panel {
      background: rgba(18, 30, 58, 0.94);
      border: 1px solid rgba(126, 155, 255, 0.16);
      border-radius: 24px;
      padding: 22px;
      box-shadow: 0 18px 38px rgba(0, 0, 0, 0.24);
      margin-bottom: 20px;
    }

    .panel h2 {
      font-size: 30px;
      font-weight: 800;
      margin-bottom: 8px;
    }

    .panel-subtitle {
      color: #aebddd;
      line-height: 1.6;
      margin-bottom: 20px;
      font-size: 15px;
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .card {
      background: rgba(7, 18, 44, 0.95);
      border: 1px solid rgba(125, 150, 255, 0.12);
      border-radius: 18px;
      padding: 18px;
    }

    .card-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 12px;
    }

    .card h3 {
      font-size: 20px;
      font-weight: 800;
      margin-bottom: 4px;
    }

    .muted {
      color: #b7c3df;
      font-size: 14px;
      line-height: 1.55;
    }

    .details {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-top: 14px;
      margin-bottom: 14px;
    }

    .detail-box {
      background: rgba(13, 26, 56, 0.96);
      border-radius: 14px;
      padding: 12px;
      border: 1px solid rgba(125, 150, 255, 0.08);
    }

    .detail-box .label {
      color: #91a7d8;
      font-size: 12px;
      margin-bottom: 5px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
    }

    .detail-box .value {
      font-size: 14px;
      line-height: 1.5;
      word-break: break-word;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      padding: 7px 12px;
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      min-width: 92px;
    }

    .badge.pending,
    .badge.ride-pending {
      background: rgba(255, 193, 7, 0.15);
      color: #ffd666;
      border: 1px solid rgba(255, 214, 102, 0.25);
    }

    .badge.approved,
    .badge.completed {
      background: rgba(40, 199, 111, 0.16);
      color: #7ef0a7;
      border: 1px solid rgba(126, 240, 167, 0.22);
    }

    .badge.rejected {
      background: rgba(255, 82, 82, 0.16);
      color: #ff9d9d;
      border: 1px solid rgba(255, 157, 157, 0.22);
    }

    .badge.active,
    .badge.assigned,
    .badge.online {
      background: rgba(41, 98, 255, 0.16);
      color: #8fb1ff;
      border: 1px solid rgba(143, 177, 255, 0.22);
    }

    .badge.offline {
      background: rgba(255, 82, 82, 0.16);
      color: #ff9d9d;
      border: 1px solid rgba(255, 157, 157, 0.22);
    }

    .action-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 8px;
      align-items: center;
    }

    .btn {
      border: none;
      border-radius: 12px;
      padding: 10px 14px;
      font-size: 14px;
      font-weight: 800;
      cursor: pointer;
      color: white;
    }

    .btn-approve,
    .btn-complete {
      background: linear-gradient(90deg, #1faa59 0%, #28c76f 100%);
    }

    .btn-reject {
      background: linear-gradient(90deg, #d63031 0%, #ff5c5c 100%);
    }

    .btn-refresh,
    .btn-assign,
    .btn-online {
      background: linear-gradient(90deg, #2962ff 0%, #7b2cff 100%);
    }

    .assign-select {
      min-width: 220px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(125, 150, 255, 0.18);
      background: rgba(8, 17, 42, 0.96);
      color: white;
    }

    .empty-state,
    .loading-box {
      background: rgba(7, 18, 44, 0.95);
      border: 1px solid rgba(125, 150, 255, 0.12);
      border-radius: 18px;
      padding: 18px;
      color: #b7c3df;
      line-height: 1.6;
    }

    .quick-panel-item {
      background: rgba(7, 18, 44, 0.95);
      border: 1px solid rgba(125, 150, 255, 0.12);
      border-radius: 18px;
      padding: 16px;
      margin-bottom: 14px;
    }

    .quick-panel-item h3 {
      font-size: 18px;
      margin-bottom: 8px;
    }

    .quick-panel-item p {
      color: #b7c3df;
      line-height: 1.55;
      font-size: 14px;
    }

    .footer-note {
      margin-top: 24px;
      text-align: center;
      color: #8fa4d1;
      font-size: 14px;
      line-height: 1.6;
    }

    @media (max-width: 1150px) {
      .summary-grid {
        grid-template-columns: repeat(4, 1fr);
      }
    }

    @media (max-width: 920px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 640px) {
      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }

      .hero h2 {
        font-size: 34px;
      }

      .hero p {
        font-size: 16px;
      }

      .summary-grid {
        grid-template-columns: 1fr;
      }

      .details {
        grid-template-columns: 1fr;
      }

      .panel h2 {
        font-size: 26px;
      }

      .card-top {
        flex-direction: column;
      }

      .assign-select {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <script>
    const isAdmin = localStorage.getItem('harveyAdminLoggedIn')
    if (!isAdmin) {
      window.location.href = '/admin-login.html'
    }
  </script>

  <div class="topbar">
    <div class="topbar-left">
      <h1>Harvey Taxi Admin</h1>
      <p id="adminEmailDisplay">Administrator session</p>
    </div>
    <button class="logout-btn" onclick="logoutAdmin()">Logout</button>
  </div>

  <div class="container">
    <section class="hero">
      <h2>🛠 Harvey Taxi Admin Panel</h2>
      <p>
        Review ride requests, assign approved drivers, complete trips, and manage driver availability.
      </p>
    </section>

    <section class="summary-grid">
      <div class="summary-card">
        <h3>Total Drivers</h3>
        <div class="number" id="totalDrivers">0</div>
      </div>

      <div class="summary-card">
        <h3>Approved Drivers</h3>
        <div class="number" id="approvedDrivers">0</div>
      </div>

      <div class="summary-card">
        <h3>Online Drivers</h3>
        <div class="number" id="onlineDrivers">0</div>
      </div>

      <div class="summary-card">
        <h3>Pending Drivers</h3>
        <div class="number" id="pendingDrivers">0</div>
      </div>

      <div class="summary-card">
        <h3>Total Riders</h3>
        <div class="number" id="totalRiders">0</div>
      </div>

      <div class="summary-card">
        <h3>Total Trips</h3>
        <div class="number" id="totalTrips">0</div>
      </div>

      <div class="summary-card">
        <h3>Pending Trips</h3>
        <div class="number" id="pendingTrips">0</div>
      </div>

      <div class="summary-card">
        <h3>Assigned Trips</h3>
        <div class="number" id="assignedTrips">0</div>
      </div>

      <div class="summary-card">
        <h3>Completed Trips</h3>
        <div class="number" id="completedTrips">0</div>
      </div>
    </section>

    <section class="grid">
      <div>
        <div class="panel">
          <h2>Ride Requests</h2>
          <p class="panel-subtitle">
            Review incoming ride requests, assign online approved drivers, and complete active trips.
          </p>

          <div class="action-row" style="margin-bottom: 18px;">
            <button class="btn btn-refresh" onclick="loadRides()">Refresh Trips</button>
          </div>

          <div id="ridesList" class="list">
            <div class="loading-box">Loading ride requests...</div>
          </div>
        </div>

        <div class="panel">
          <h2>Driver Applications</h2>
          <p class="panel-subtitle">
            Review drivers, approve them, and control online or offline availability.
          </p>

          <div class="action-row" style="margin-bottom: 18px;">
            <button class="btn btn-refresh" onclick="loadDrivers()">Refresh Drivers</button>
          </div>

          <div id="driversList" class="list">
            <div class="loading-box">Loading drivers...</div>
          </div>
        </div>

        <div class="panel">
          <h2>Rider Accounts</h2>
          <p class="panel-subtitle">
            Review rider registrations and account details stored in the system.
          </p>

          <div class="action-row" style="margin-bottom: 18px;">
            <button class="btn btn-refresh" onclick="loadRiders()">Refresh Riders</button>
          </div>

          <div id="ridersList" class="list">
            <div class="loading-box">Loading riders...</div>
          </div>
        </div>
      </div>

      <div>
        <div class="panel">
          <h2>Platform Snapshot</h2>
          <p class="panel-subtitle">
            Quick status boxes for your current Harvey Taxi build.
          </p>

          <div class="quick-panel-item">
            <h3>Driver Availability</h3>
            <p>
              Approved drivers can now be toggled online and offline for better dispatch control.
            </p>
          </div>

          <div class="quick-panel-item">
            <h3>Trip Lifecycle</h3>
            <p>
              Trips move from pending to assigned to completed and automatically free the driver again.
            </p>
          </div>

          <div class="quick-panel-item">
            <h3>Dispatch Control</h3>
            <p>
              Only approved and online drivers should be used for active ride assignments.
            </p>
          </div>

          <div class="quick-panel-item">
            <h3>Next System Upgrade</h3>
            <p>
              Next we can build driver-side ride acceptance or auto-dispatch to the nearest driver.
            </p>
          </div>
        </div>
      </div>
    </section>

    <p class="footer-note">
      Harvey Taxi Service LLC — Admin dashboard for approvals, rides, dispatch, completion, and live driver availability.
    </p>
  </div>

  <script>
    const adminEmail = localStorage.getItem('harveyAdminEmail') || 'Administrator session'
    document.getElementById('adminEmailDisplay').textContent = adminEmail

    let cachedDrivers = []
    let cachedRiders = []
    let cachedRides = []

    function logoutAdmin() {
      localStorage.removeItem('harveyAdminLoggedIn')
      localStorage.removeItem('harveyAdminEmail')
      window.location.href = '/admin-login.html'
    }

    function getApprovedDrivers() {
      return cachedDrivers.filter(driver =>
        (driver.approved === true || driver.status === 'approved') &&
        driver.online === true
      )
    }

    function getDriverStatus(driver) {
      if (driver.status === 'approved' || driver.approved === true) return 'approved'
      if (driver.status === 'rejected') return 'rejected'
      return 'pending'
    }

    function getRideStatus(ride) {
      if (ride.status === 'completed') return 'completed'
      if (ride.status === 'assigned') return 'assigned'
      return 'pending'
    }

    function driverBadge(status) {
      if (status === 'approved') return '<span class="badge approved">Approved</span>'
      if (status === 'rejected') return '<span class="badge rejected">Rejected</span>'
      return '<span class="badge pending">Pending</span>'
    }

    function availabilityBadge(driver) {
      if (driver.online === true) return '<span class="badge online">Online</span>'
      return '<span class="badge offline">Offline</span>'
    }

    function riderBadge() {
      return '<span class="badge active">Active</span>'
    }

    function rideBadge(status) {
      if (status === 'completed') return '<span class="badge completed">Completed</span>'
      if (status === 'assigned') return '<span class="badge assigned">Assigned</span>'
      return '<span class="badge ride-pending">Pending</span>'
    }

    async function approveDriver(id) {
      try {
        const res = await fetch('/api/approve-driver', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        })

        const data = await res.json()

        if (data.success) {
          await loadDrivers()
          await loadRides()
        } else {
          alert(data.message || 'Could not approve driver.')
        }
      } catch (err) {
        alert('Server error approving driver.')
      }
    }

    async function rejectDriver(id) {
      try {
        const res = await fetch('/api/reject-driver', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        })

        const data = await res.json()

        if (data.success) {
          await loadDrivers()
          await loadRides()
        } else {
          alert(data.message || 'Could not reject driver.')
        }
      } catch (err) {
        alert('Server error rejecting driver.')
      }
    }

    async function toggleDriverOnline(driverId) {
      try {
        const res = await fetch('/api/toggle-driver-online', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId })
        })

        const data = await res.json()

        if (data.success) {
          await loadDrivers()
          await loadRides()
        } else {
          alert(data.message || 'Could not update driver availability.')
        }
      } catch (err) {
        alert('Server error updating driver availability.')
      }
    }

    async function assignDriver(rideId) {
      const select = document.getElementById(`assign-driver-${rideId}`)

      if (!select || !select.value) {
        alert('Please choose an online approved driver first.')
        return
      }

      try {
        const res = await fetch('/api/assign-driver', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rideId,
            driverId: select.value
          })
        })

        const data = await res.json()

        if (data.success) {
          await loadDrivers()
          await loadRides()
        } else {
          alert(data.message || 'Could not assign driver.')
        }
      } catch (err) {
        alert('Server error assigning driver.')
      }
    }

    async function completeTrip(rideId) {
      try {
        const res = await fetch('/api/complete-trip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rideId })
        })

        const data = await res.json()

        if (data.success) {
          await loadDrivers()
          await loadRides()
        } else {
          alert(data.message || 'Could not complete trip.')
        }
      } catch (err) {
        alert('Server error completing trip.')
      }
    }

    function buildDriverOptions(selectedDriverId = '') {
      const approvedDrivers = getApprovedDrivers()

      if (!approvedDrivers.length) {
        return '<option value="">No online approved drivers available</option>'
      }

      const options = ['<option value="">Choose online approved driver</option>']

      approvedDrivers.forEach((driver) => {
        const isSelected = String(driver.id) === String(selectedDriverId) ? 'selected' : ''
        options.push(
          `<option value="${driver.id}" ${isSelected}>${driver.name || 'Unnamed Driver'}${driver.vehicle ? ' — ' + driver.vehicle : ''}</option>`
        )
      })

      return options.join('')
    }

    function renderRideCard(ride) {
      const status = getRideStatus(ride)
      const name = ride.name || 'Unnamed Rider'
      const phone = ride.phone || 'No phone provided'
      const pickup = ride.pickup || 'Not provided'
      const dropoff = ride.dropoff || 'Not provided'
      const service = ride.service || 'Standard Ride'
      const pickupTime = ride.pickupTime || 'ASAP'
      const notes = ride.notes || 'No notes'
      const assignedDriverName = ride.assignedDriverName || 'Unassigned'
      const completedAt = ride.completedAt || 'Not completed'

      return `
        <div class="card">
          <div class="card-top">
            <div>
              <h3>${name}</h3>
              <div class="muted">${phone}</div>
            </div>
            <div>${rideBadge(status)}</div>
          </div>

          <div class="details">
            <div class="detail-box">
              <div class="label">Pickup</div>
              <div class="value">${pickup}</div>
            </div>

            <div class="detail-box">
              <div class="label">Dropoff</div>
              <div class="value">${dropoff}</div>
            </div>

            <div class="detail-box">
              <div class="label">Service</div>
              <div class="value">${service}</div>
            </div>

            <div class="detail-box">
              <div class="label">Pickup Time</div>
              <div class="value">${pickupTime}</div>
            </div>

            <div class="detail-box">
              <div class="label">Assigned Driver</div>
              <div class="value">${assignedDriverName}</div>
            </div>

            <div class="detail-box">
              <div class="label">Completed At</div>
              <div class="value">${completedAt}</div>
            </div>

            <div class="detail-box">
              <div class="label">Notes</div>
              <div class="value">${notes}</div>
            </div>
          </div>

          <div class="action-row">
            <select class="assign-select" id="assign-driver-${ride.id}">
              ${buildDriverOptions(ride.assignedDriverId || '')}
            </select>
            <button class="btn btn-assign" onclick="assignDriver('${String(ride.id).replace(/'/g, "\\'")}')">Assign Driver</button>
            ${status === 'assigned' ? `<button class="btn btn-complete" onclick="completeTrip('${String(ride.id).replace(/'/g, "\\'")}')">Complete Trip</button>` : ''}
          </div>
        </div>
      `
    }

    function renderDriverCard(driver) {
      const status = getDriverStatus(driver)
      const name = driver.name || 'Unnamed Driver'
      const email = driver.email || 'No email provided'
      const phone = driver.phone || 'No phone provided'
      const vehicle = driver.vehicle || 'Not provided'
      const license = driver.license || 'Not provided'
      const city = driver.city || 'Not provided'
      const currentRideId = driver.currentRideId || 'None'
      const id = driver.id || email || name

      return `
        <div class="card">
          <div class="card-top">
            <div>
              <h3>${name}</h3>
              <div class="muted">${email}</div>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              ${driverBadge(status)}
              ${availabilityBadge(driver)}
            </div>
          </div>

          <div class="details">
            <div class="detail-box">
              <div class="label">Phone</div>
              <div class="value">${phone}</div>
            </div>

            <div class="detail-box">
              <div class="label">Vehicle</div>
              <div class="value">${vehicle}</div>
            </div>

            <div class="detail-box">
              <div class="label">License</div>
              <div class="value">${license}</div>
            </div>

            <div class="detail-box">
              <div class="label">City</div>
              <div class="value">${city}</div>
            </div>

            <div class="detail-box">
              <div class="label">Current Ride</div>
              <div class="value">${currentRideId}</div>
            </div>
          </div>

          <div class="action-row">
            <button class="btn btn-approve" onclick="approveDriver('${String(id).replace(/'/g, "\\'")}')">Approve</button>
            <button class="btn btn-reject" onclick="rejectDriver('${String(id).replace(/'/g, "\\'")}')">Reject</button>
            ${(driver.approved === true || driver.status === 'approved') ? `<button class="btn btn-online" onclick="toggleDriverOnline('${String(id).replace(/'/g, "\\'")}')">${driver.online ? 'Go Offline' : 'Go Online'}</button>` : ''}
          </div>
        </div>
      `
    }

    function renderRiderCard(rider) {
      const name = rider.name || 'Unnamed Rider'
      const email = rider.email || 'No email provided'
      const phone = rider.phone || 'No phone provided'
      const city = rider.city || 'Not provided'
      const created = rider.createdAt || 'Registered'

      return `
        <div class="card">
          <div class="card-top">
            <div>
              <h3>${name}</h3>
              <div class="muted">${email}</div>
            </div>
            <div>${riderBadge()}</div>
          </div>

          <div class="details">
            <div class="detail-box">
              <div class="label">Phone</div>
              <div class="value">${phone}</div>
            </div>

            <div class="detail-box">
              <div class="label">City</div>
              <div class="value">${city}</div>
            </div>

            <div class="detail-box">
              <div class="label">Status</div>
              <div class="value">Registered rider</div>
            </div>

            <div class="detail-box">
              <div class="label">Created</div>
              <div class="value">${created}</div>
            </div>
          </div>
        </div>
      `
    }

    async function loadRides() {
      const ridesList = document.getElementById('ridesList')
      ridesList.innerHTML = '<div class="loading-box">Loading ride requests...</div>'

      try {
        const res = await fetch('/api/rides')
        const rides = await res.json()

        if (!Array.isArray(rides) || rides.length === 0) {
          ridesList.innerHTML = `<div class="empty-state">No ride requests found yet.</div>`
          updateCounts(null, null, [])
          return
        }

        cachedRides = rides
        ridesList.innerHTML = rides.map(renderRideCard).join('')
        updateCounts(null, null, rides)
      } catch (err) {
        ridesList.innerHTML = `<div class="empty-state">Could not load ride requests right now.</div>`
        updateCounts(null, null, [])
      }
    }

    async function loadDrivers() {
      const driversList = document.getElementById('driversList')
      driversList.innerHTML = '<div class="loading-box">Loading drivers...</div>'

      try {
        const res = await fetch('/api/drivers')
        const drivers = await res.json()

        if (!Array.isArray(drivers) || drivers.length === 0) {
          driversList.innerHTML = `<div class="empty-state">No driver applications found yet.</div>`
          updateCounts([], null, null)
          return
        }

        cachedDrivers = drivers
        driversList.innerHTML = drivers.map(renderDriverCard).join('')
        updateCounts(drivers, null, null)
      } catch (err) {
        driversList.innerHTML = `<div class="empty-state">Could not load driver applications right now.</div>`
        updateCounts([], null, null)
      }
    }

    async function loadRiders() {
      const ridersList = document.getElementById('ridersList')
      ridersList.innerHTML = '<div class="loading-box">Loading riders...</div>'

      try {
        const res = await fetch('/api/riders')
        const riders = await res.json()

        if (!Array.isArray(riders) || riders.length === 0) {
          ridersList.innerHTML = `<div class="empty-state">No rider accounts found yet.</div>`
          updateCounts(null, [], null)
          return
        }

        cachedRiders = riders
        ridersList.innerHTML = riders.map(renderRiderCard).join('')
        updateCounts(null, riders, null)
      } catch (err) {
        ridersList.innerHTML = `<div class="empty-state">Could not load rider accounts right now.</div>`
        updateCounts(null, [], null)
      }
    }

    function updateCounts(drivers, riders, rides) {
      if (Array.isArray(drivers)) cachedDrivers = drivers
      if (Array.isArray(riders)) cachedRiders = riders
      if (Array.isArray(rides)) cachedRides = rides

      const approved = cachedDrivers.filter(driver => driver.status === 'approved' || driver.approved === true).length
      const online = cachedDrivers.filter(driver => driver.online === true).length
      const pendingDrivers = cachedDrivers.filter(driver => driver.status !== 'approved' && driver.approved !== true && driver.status !== 'rejected').length
      const pendingTrips = cachedRides.filter(ride => !ride.status || ride.status === 'pending').length
      const assignedTrips = cachedRides.filter(ride => ride.status === 'assigned').length
      const completedTrips = cachedRides.filter(ride => ride.status === 'completed').length

      document.getElementById('totalDrivers').textContent = cachedDrivers.length
      document.getElementById('approvedDrivers').textContent = approved
      document.getElementById('onlineDrivers').textContent = online
      document.getElementById('pendingDrivers').textContent = pendingDrivers
      document.getElementById('totalRiders').textContent = cachedRiders.length
      document.getElementById('totalTrips').textContent = cachedRides.length
      document.getElementById('pendingTrips').textContent = pendingTrips
      document.getElementById('assignedTrips').textContent = assignedTrips
      document.getElementById('completedTrips').textContent = completedTrips
    }

    async function boot() {
      await loadDrivers()
      await loadRides()
      await loadRiders()
    }

    boot()
  </script>
</body>
</html>
