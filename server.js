const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

/* DATA */

let rides = []

let drivers = [
{
id: 'driver_1',
name: 'Marcus Johnson',
vehicle: 'Toyota Camry',
plate: 'HTX-101',
phone: '615-555-0101',
online: true,
lat: 36.1627,
lng: -86.7816
},
{
id: 'driver_2',
name: 'Alicia Brown',
vehicle: 'Honda Accord',
plate: 'HTX-202',
phone: '615-555-0102',
online: true,
lat: 36.1745,
lng: -86.7679
},
{
id: 'driver_3',
name: 'David Carter',
vehicle: 'Nissan Altima',
plate: 'HTX-303',
phone: '615-555-0103',
online: true,
lat: 36.157,
lng: -86.804
}
]

/* FARE */

const fareSettings = {
base: 8,
perMile: 2.25,
booking: 2.50
}

/* REQUEST RIDE */

app.post('/api/request-ride', (req, res) => {

const { pickup, dropoff, rideType } = req.body

if(!pickup || !dropoff){
return res.status(400).json({
error: 'Pickup and dropoff required'
})
}

const ride = {
id: 'ride_' + Date.now(),
pickup,
dropoff,
rideType,
status: 'searching',
created: new Date()
}

rides.push(ride)

res.json({
success: true,
message: 'Searching for nearby drivers...',
ride
})

})

/* GET DRIVERS */

app.get('/api/drivers', (req,res)=>{
res.json(drivers)
})

/* GET RIDES */

app.get('/api/rides', (req,res)=>{
res.json(rides)
})

/* ROOT */

app.get('/', (req, res) => {
res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

/* START SERVER */

app.listen(PORT, () => {
console.log('Harvey Taxi running on port ' + PORT)
})
