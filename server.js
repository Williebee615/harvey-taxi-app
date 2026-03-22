app.post('/api/fare/estimate', (req, res) => {
  try {
    const { pickupAddress, dropoffAddress } = req.body

    if (!pickupAddress || !dropoffAddress) {
      return res.status(400).json({
        success: false,
        message: 'Pickup and dropoff addresses are required.'
      })
    }

    // Temporary estimate until live geocoding is added
    const estimatedDistanceMiles = 6.5
    const estimatedDurationMinutes = 18
    const surgeMultiplier = calculateDemandMultiplier()

    const fare = calculateFare({
      distanceMiles: estimatedDistanceMiles,
      durationMinutes: estimatedDurationMinutes,
      surgeMultiplier
    })

    return res.json({
      success: true,
      trip: {
        pickupAddress,
        dropoffAddress,
        distanceMiles: estimatedDistanceMiles,
        durationMinutes: estimatedDurationMinutes
      },
      fare
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to calculate fare.',
      error: error.message
    })
  }
})
