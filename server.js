const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')

app.use(cors())
app.use(express.json())
app.use(express.static('public'))

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { drivers: [] }
  }

  return JSON.parse(fs.readFileSync(DATA_FILE))
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'))
})

/* REGISTER DRIVER */
app.post('/api/drivers/register', (req, res) => {
  const { id, name } = req.body

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

  res.json({
    success: true,
    driver
  })
})

/* ADD EARNINGS */
app.post('/api/driver/add-earnings', (req, res) => {
  const { driverId, amount } = req.body

  const data = loadData()

  let driver = data.drivers.find(d => d.id === driverId)

  // auto create driver
  if (!driver) {
    driver = {
      id: driverId,
      name: "Auto Driver",
      wallet: 0
    }

    data.drivers.push(driver)
  }

  driver.wallet += Number(amount)

  saveData(data)

  res.json({
    success: true,
    wallet: driver.wallet
  })
})

/* GET WALLET */
app.get('/api/driver/wallet/:driverId', (req, res) => {
  const { driverId } = req.params

  const data = loadData()

  const driver = data.drivers.find(d => d.id === driverId)

  if (!driver) {
    return res.json({ wallet: 0 })
  }

  res.json({
    wallet: driver.wallet
  })
})

app.listen(PORT, () => {
  console.log('Harvey Taxi Server Running')
})
