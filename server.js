const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

let users = {
riders: [],
drivers: [],
admins: [
{
email: "admin@harveytaxi.com",
password: "admin123"
}
]
}

let rides = []

// RIDER SIGNUP
app.post('/api/rider/signup', (req,res)=>{
const rider = {
id: Date.now().toString(),
name: req.body.name,
email: req.body.email,
phone: req.body.phone
}

users.riders.push(rider)

res.json({
success:true,
rider
})
})

// DRIVER SIGNUP
app.post('/api/driver/signup', (req,res)=>{
const driver = {
id: Date.now().toString(),
name: req.body.name,
email: req.body.email,
car: req.body.car,
approved:false,
online:false
}

users.drivers.push(driver)

res.json({
success:true,
driver
})
})

// LOGIN
app.post('/api/login',(req,res)=>{
const {email} = req.body

const rider = users.riders.find(u=>u.email===email)
if(rider) return res.json({type:'rider',user:rider})

const driver = users.drivers.find(u=>u.email===email)
if(driver) return res.json({type:'driver',user:driver})

const admin = users.admins.find(u=>u.email===email)
if(admin) return res.json({type:'admin',user:admin})

res.json({error:"User not found"})
})

// REQUEST RIDE
app.post('/api/request-ride',(req,res)=>{
const ride = {
id: Date.now().toString(),
pickup:req.body.pickup,
dropoff:req.body.dropoff,
status:"waiting"
}

rides.push(ride)

res.json(ride)
})

// GET RIDES
app.get('/api/rides',(req,res)=>{
res.json(rides)
})

app.listen(PORT,()=>{
console.log("Harvey Taxi Running")
})
