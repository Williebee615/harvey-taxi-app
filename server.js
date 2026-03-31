const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const axios = require('axios')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const DATA_FILE = path.join(__dirname, 'data.json')

function readData() {
if (!fs.existsSync(DATA_FILE)) {
fs.writeFileSync(DATA_FILE, JSON.stringify({
drivers: [],
riders: [],
rides: []
}, null, 2))
}
return JSON.parse(fs.readFileSync(DATA_FILE))
}

function writeData(data) {
fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

app.get('/', (req, res) => {
res.sendFile(path.join(__dirname, 'public/index.html'))
})

/* ===============================
DRIVER SIGNUP
=============================== */

app.post('/api/driver/signup', async (req, res) => {
try {

const data = readData()

const driver = {
id: Date.now().toString(),
name: req.body.name,
email: req.body.email,
phone: req.body.phone,
vehicle: req.body.vehicle,
status: "pending",
persona_status: "pending",
checkr_status: "pending"
}

data.drivers.push(driver)
writeData(data)

const inquiry = await axios.post(
'https://api.withpersona.com/api/v1/inquiries',
{
data: {
attributes: {
inquiry_template_id: process.env.PERSONA_TEMPLATE_ID_DRIVER,
reference_id: driver.id
}
}
},
{
headers: {
Authorization: `Bearer ${process.env.PERSONA_API_KEY}`,
'Content-Type': 'application/json'
}
}
)

res.json({
success: true,
driver,
persona_url: inquiry.data.data.attributes.inquiry_url
})

} catch (err) {
console.log(err)
res.status(500).json({ error: 'Driver signup failed' })
}
})

/* ===============================
RIDER SIGNUP
=============================== */

app.post('/api/rider/signup', async (req, res) => {
try {

const data = readData()

const rider = {
id: Date.now().toString(),
name: req.body.name,
email: req.body.email,
phone: req.body.phone,
status: "active"
}

data.riders.push(rider)
writeData(data)

const inquiry = await axios.post(
'https://api.withpersona.com/api/v1/inquiries',
{
data: {
attributes: {
inquiry_template_id: process.env.PERSONA_TEMPLATE_ID_RIDER,
reference_id: rider.id
}
}
},
{
headers: {
Authorization: `Bearer ${process.env.PERSONA_API_KEY}`,
'Content-Type': 'application/json'
}
}
)

res.json({
success: true,
rider,
persona_url: inquiry.data.data.attributes.inquiry_url
})

} catch (err) {
console.log(err)
res.status(500).json({ error: 'Rider signup failed' })
}
})

/* ===============================
PERSONA WEBHOOK
=============================== */

app.post('/webhook/persona', (req, res) => {

const event = req.body
const data = readData()

if (event.data?.attributes?.status === "completed") {

const reference = event.data.attributes.reference_id

const driver = data.drivers.find(d => d.id === reference)

if (driver) {
driver.persona_status = "approved"
driver.status = "approved"
}

writeData(data)
}

res.sendStatus(200)
})

/* ===============================
CHECKR WEBHOOK
=============================== */

app.post('/webhook/checkr', (req, res) => {

const event = req.body
const data = readData()

if (event.type === "report.completed") {

const candidateId = event.data.object.candidate_id

const driver = data.drivers.find(d => d.checkr_candidate_id === candidateId)

if (driver) {
driver.checkr_status = "approved"
driver.status = "approved"
}

writeData(data)
}

res.sendStatus(200)
})

/* ===============================
GET DRIVERS
=============================== */

app.get('/api/drivers', (req, res) => {
const data = readData()
res.json(data.drivers)
})

/* ===============================
GET RIDERS
=============================== */

app.get('/api/riders', (req, res) => {
const data = readData()
res.json(data.riders)
})

/* ===============================
REQUEST RIDE
=============================== */

app.post('/api/request-ride', (req, res) => {

const data = readData()

const ride = {
id: Date.now().toString(),
pickup: req.body.pickup,
dropoff: req.body.dropoff,
rider: req.body.rider,
status: "searching",
created: new Date()
}

data.rides.push(ride)
writeData(data)

res.json({ success: true, ride })
})

/* ===============================
GET RIDES
=============================== */

app.get('/api/rides', (req, res) => {
const data = readData()
res.json(data.rides)
})

/* ===============================
STATIC FALLBACK
=============================== */

app.get('/:page', (req, res) => {

const file = path.join(__dirname, 'public', req.params.page)

if (fs.existsSync(file)) {
res.sendFile(file)
} else {
res.sendFile(path.join(__dirname, 'public/index.html'))
}

})

app.listen(PORT, () => {
console.log("Harvey Taxi Autonomous Server Running")
})
