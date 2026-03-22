const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')

app.use(cors())
app.use(express.json({ limit: '15mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public')))

/* ------------------ DATA ------------------ */

function loadData() {
if (!fs.existsSync(DATA_FILE)) {
const seed = {
users:{
riders:[],
drivers:[],
admins:[]
},
requests:[]
}
fs.writeFileSync(DATA_FILE, JSON.stringify(seed,null,2))
return seed
}

return JSON.parse(fs.readFileSync(DATA_FILE))
}

function saveData(){
fs.writeFileSync(DATA_FILE, JSON.stringify(db,null,2))
}

let db = loadData()

/* ------------------ AUTH ------------------ */

app.post('/api/auth/login',(req,res)=>{
const {email,password} = req.body

const user = [
...db.users.riders,
...db.users.drivers
].find(u=>u.email===email && u.password===password)

if(!user){
return res.status(401).json({error:"Invalid login"})
}

res.json({user})
})

/* ------------------ CREATE REQUEST ------------------ */

app.post('/api/requests/create',(req,res)=>{

const {
riderId,
serviceType,
pickupAddress,
pickupLat,
pickupLng,
dropoffAddress,
notes
} = req.body

const rider = db.users.riders.find(r=>r.id===riderId)

if(!rider){
return res.status(404).json({error:"Rider not found"})
}

const request = {
id:"req_"+Date.now(),
riderId,
serviceType,
pickupAddress,
pickupLat,
pickupLng,
dropoffAddress,
notes,
status:"searching",
created:new Date()
}

db.requests.push(request)
saveData()

res.json({
message:"Driver search started",
request
})

})

/* ------------------ GET REQUESTS FOR DRIVER ------------------ */

app.get('/api/driver/requests',(req,res)=>{
res.json(db.requests)
})

/* ------------------ ROOT ------------------ */

app.get('/', (req,res)=>{
res.sendFile(path.join(__dirname,'public/index.html'))
})

/* ------------------ FALLBACK ------------------ */

app.get('/:page', (req,res)=>{
const file = path.join(__dirname,'public',req.params.page)

if(fs.existsSync(file)){
res.sendFile(file)
}else{
res.sendFile(path.join(__dirname,'public/index.html'))
}
})

app.listen(PORT, ()=>{
console.log("Server running on port " + PORT)
})
