const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

function readData() {
if (!fs.existsSync(DATA_FILE)) {
fs.writeFileSync(DATA_FILE, JSON.stringify({
drivers: [],
riders: [],
serviceRequests: []
}, null, 2))
}
return JSON.parse(fs.readFileSync(DATA_FILE))
}

function writeData(data) {
fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

app.get('/', (req,res)=>{
res.sendFile(path.join(__dirname,'public/index.html'))
})

app.get('/admin-dispatch',(req,res)=>{
res.sendFile(path.join(__dirname,'public/admin-dispatch.html'))
})

app.get('/driver',(req,res)=>{
res.sendFile(path.join(__dirname,'public/driver.html'))
})

app.get('/api/service-requests',(req,res)=>{
const data = readData()
res.json({requests:data.serviceRequests})
})

app.post('/api/request-ride',(req,res)=>{
const data = readData()

const ride = {
id: Date.now().toString(),
pickup: req.body.pickup,
dropoff: req.body.dropoff,
riderName: req.body.riderName,
riderPhone: req.body.riderPhone,
status:'pending'
}

data.serviceRequests.unshift(ride)
writeData(data)

res.json({success:true})
})

app.post('/api/driver/accept',(req,res)=>{
const data = readData()

const ride = data.serviceRequests.find(r=>r.id===req.body.rideId)

if(ride){
ride.status='assigned'
ride.driverId=req.body.driverId
}

writeData(data)
res.json({success:true})
})

app.post('/api/driver/start',(req,res)=>{
const data = readData()

const ride = data.serviceRequests.find(r=>r.id===req.body.rideId)

if(ride){
ride.status='in_progress'
}

writeData(data)
res.json({success:true})
})

app.post('/api/driver/complete',(req,res)=>{
const data = readData()

const ride = data.serviceRequests.find(r=>r.id===req.body.rideId)

if(ride){
ride.status='completed'
}

writeData(data)
res.json({success:true})
})

app.listen(PORT,()=>{
console.log("Harvey Taxi running on port",PORT)
})
