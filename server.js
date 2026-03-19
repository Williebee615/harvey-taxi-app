const express = require('express')
const cors = require('cors')

const app = express()

app.use(cors())
app.use(express.json())

// Test route (VERY IMPORTANT)
app.get('/', (req, res) => {
  res.send('Harvey Taxi API is running 🚕')
})

// Your ride request route
app.post('/request-ride', (req, res) => {
  console.log('Incoming ride:', req.body)

  res.json({
    success: true,
    message: 'Ride received successfully',
  })
})

const PORT = process.env.PORT || 10000

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
