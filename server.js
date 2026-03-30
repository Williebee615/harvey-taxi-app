const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const DATA_FILE = 'data.json'

function loadData() {
if (!fs.existsSync(DATA_FILE)) {
fs.writeFileSync(DATA_FILE, JSON.stringify({
drivers: [],
riders: [],
rides: []
}))
}
return JSON.parse(fs.readFileSync(DATA_FILE))
}

function saveData(data) {
fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function makeId(prefix) {
return prefix + '_' + Math.random().toString(36).substring(2, 9)
}

/* DRIVER SIGNUP */
app.post('/signup-driver', (req, res) => {
const data = loadData()
const { name, phone, email, vehicle, city } = req.body

const driver = {
id: makeId('driver'),
name,
phone,
email,
vehicle,
city,
status: "pending",
verified: false,
approved: false
}

data.drivers.push(driver)
saveData(data)

res.json({ success: true })
})

/* RIDER SIGNUP */
app.post('/signup-rider', (req, res) => {
const data = loadData()
const { name, phone, email } = req.body

const rider = {
id: makeId('rider'),
name,
phone,
email
}

data.riders.push(rider)
saveData(data)

res.json({ success: true })
})

/* REQUEST RIDE */
app.post('/request-ride', (req, res) => {
const data = loadData()
const { pickup, dropoff, service } = req.body

const ride = {
id: makeId('ride'),
pickup,
dropoff,
service,
status: "waiting"
}

data.rides.push(ride)
saveData(data)

res.json({ success: true })
})

/* GET DRIVERS */
app.get('/drivers', (req,res)=>{
const data = loadData()
res.json(data.drivers)
})

/* GET RIDERS */
app.get('/riders', (req,res)=>{
const data = loadData()
res.json(data.riders)
})

/* GET RIDES */
app.get('/rides', (req,res)=>{
const data = loadData()
res.json(data.rides)
})

/* APPROVE DRIVER */
app.post('/approve-driver', (req,res)=>{
const data = loadData()
const { id } = req.body

const driver = data.drivers.find(d=>d.id===id)

if(driver){
driver.approved = true
driver.status = "approved"
}

saveData(data)
res.json({success:true})
})

/* REJECT DRIVER */
app.post('/reject-driver', (req,res)=>{
const data = loadData()
const { id } = req.body

const driver = data.drivers.find(d=>d.id===id)

if(driver){
driver.approved = false
driver.status = "rejected"
}

saveData(data)
res.json({success:true})
})

/* FALLBACK */
app.get('*', (req,res)=>{
res.sendFile(path.join(__dirname,'public/index.html'))
})

app.listen(PORT, ()=>{
console.log("Server running on port " + PORT)
})
