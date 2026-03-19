function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}app.post('/api/request-ride', (req, res) => {
  const { riderId, pickup, dropoff } = req.body

  if (!pickup || !pickup.lat || !pickup.lng) {
    return res.status(400).json({ error: 'Pickup location required' })
  }

  // Find nearest driver
  let nearestDriver = null
  let minDistance = Infinity

  drivers.forEach(driver => {
    const distance = getDistance(
      pickup.lat,
      pickup.lng,
      driver.lat,
      driver.lng
    )

    if (distance < minDistance) {
      minDistance = distance
      nearestDriver = driver
    }
  })

  const newRide = {
    id: Date.now(),
    riderId,
    pickup,
    dropoff,
    status: nearestDriver ? 'matched' : 'waiting',
    driver: nearestDriver || null,
    distance: nearestDriver ? minDistance : null
  }

  rideRequests.push(newRide)

  res.json({
    success: true,
    ride: newRide
  })
})
