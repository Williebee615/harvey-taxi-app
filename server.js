// ADMIN LOGIN
app.post('/api/admin-login', (req, res) => {
const { email, password } = req.body

if (
email === 'admin@harveytaxi.com' &&
password === 'HarveyAdmin123!'
) {
return res.json({
success: true
})
}

res.status(401).json({
success:false,
message:'Invalid login'
})
})const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static('public'))

// create files if missing
if (!fs.existsSync('drivers.json')) {
fs.writeFileSync('drivers.json', '[]')
}

if (!fs.existsSync('riders.json')) {
fs.writeFileSync('riders.json', '[]')
}

// GET drivers
app.get('/api/drivers', (req, res) => {
const drivers = JSON.parse(fs.readFileSync('drivers.json'))
res.json(drivers)
})

// GET riders
app.get('/api/riders', (req, res) => {
const riders = JSON.parse(fs.readFileSync('riders.json'))
res.json(riders)
})

// approve driver
app.post('/api/approve-driver', (req, res) => {
const { id } = req.body

let drivers = JSON.parse(fs.readFileSync('drivers.json'))

drivers = drivers.map(d => {
if (d.id === id) {
d.status = 'approved'
}
return d
})

fs.writeFileSync('drivers.json', JSON.stringify(drivers,null,2))

res.json({success:true})
})

// reject driver
app.post('/api/reject-driver', (req, res) => {
const { id } = req.body

let drivers = JSON.parse(fs.readFileSync('drivers.json'))

drivers = drivers.map(d => {
if (d.id === id) {
d.status = 'rejected'
}
return d
})

fs.writeFileSync('drivers.json', JSON.stringify(drivers,null,2))

res.json({success:true})
})

app.listen(PORT, () => {
console.log('Harvey Taxi Server Running')
})
