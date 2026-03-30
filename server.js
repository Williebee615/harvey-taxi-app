const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {
        drivers: []
      }
    }

    const raw = fs.readFileSync(DATA_FILE, 'utf8')

    if (!raw.trim()) {
      return {
        drivers: []
      }
    }

    return JSON.parse(raw)
  } catch (error) {
    console.error('loadData error:', error.message)
    return {
      drivers: []
    }
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Harvey Taxi server is running'
  })
})

app.post('/api/drivers/register', (req, res) => {
  try {
    const { id, name } = req.body

    if (!id || !name) {
      return res.status(400).json({
        success: false,
        message: 'id and name are required'
      })
    }

    const data = loadData()

    let driver = data.drivers.find(d => d.id === id)

    if (!driver) {
      driver = {
        id,
        name,
        wallet: 0
      }

      data.drivers.push(driver)
      saveData(data)
    }

    return res.json({
      success: true,
      driver
    })
  } catch (error) {
    console.error('register error:', error.message)
    return res.status(500).json({
      success: false,
      message: 'Failed to register driver'
    })
  }
})

app.post('/api/driver/add-earnings', (req, res) => {
  try {
    const { driverId, amount } = req.body

    if (!driverId || amount === undefined) {
      return res.status(400).json({
        success: false,
        message: 'driverId and amount are required'
      })
    }

    const numericAmount = Number(amount)

    if (Number.isNaN(numericAmount)) {
      return res.status(400).json({
        success: false,
        message: 'amount must be a number'
      })
    }

    const data = loadData()
    const driver = data.drivers.find(d => d.id === driverId)

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      })
    }

    driver.wallet = Number(driver.wallet || 0) + numericAmount
    saveData(data)

    return res.json({
      success: true,
      wallet: driver.wallet
    })
  } catch (error) {
    console.error('add earnings error:', error.message)
    return res.status(500).json({
      success: false,
      message: 'Failed to add earnings'
    })
  }
})

app.get('/api/driver/wallet/:driverId', (req, res) => {
  try {
    const { driverId } = req.params
    const data = loadData()
    const driver = data.drivers.find(d => d.id === driverId)

    if (!driver) {
      return res.json({
        success: true,
        wallet: 0
      })
    }

    return res.json({
      success: true,
      wallet: Number(driver.wallet || 0)
    })
  } catch (error) {
    console.error('wallet error:', error.message)
    return res.status(500).json({
      success: false,
      message: 'Failed to load wallet'
    })
  }
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`)
})
