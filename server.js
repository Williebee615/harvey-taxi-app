app.post('/api/driver/add-earnings', (req, res) => {
  try {
    const { driverId, amount } = req.body

    const data = loadData()

    let driver = data.drivers.find(d => d.id === driverId)

    // auto create driver if missing
    if (!driver) {
      driver = {
        id: driverId,
        name: "Auto Driver",
        wallet: 0
      }

      data.drivers.push(driver)
    }

    driver.wallet = Number(driver.wallet || 0) + Number(amount)

    saveData(data)

    res.json({
      success: true,
      wallet: driver.wallet
    })

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    })
  }
})
