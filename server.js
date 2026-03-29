const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static('public'))

const DATA_FILE = 'data.json'

// create file if missing
if (!fs.existsSync(DATA_FILE)) {
fs.writeFileSync(DATA_FILE, JSON.stringify({
drivers: [],
riders: [],
requests: []
}, null, 2))
}

function readData(){
return JSON.parse(fs.readFileSync(DATA_FILE))
}

function writeData(data){
fs.writeFileSync(DATA_FILE, JSON.stringify(data,null,2))
}

app.get('/', (req,res)=>{
res.sendFile(path.join(__dirname,'public/index.html'))
})

/* DRIVER LOGIN */
app.post('/api/driver/login',(req,res)=>{
const {email,password} = req.body
const data = readData()

const driver = data.drivers.find(
d=>d.email===email && d.password===password
)

if(driver){
res.json({driver})
}else{
res.json({})
}
})

/* GET DRIVERS */
app.get('/api/drivers',(req,res)=>{
const data = readData()
res.json(data.drivers)
})

/* APPROVE DRIVER */
app.post('/api/driver/approve',(req,res)=>{
const {id} = req.body
const data = readData()

const driver = data.drivers.find(d=>d.id===id)

if(driver){
driver.approved = true
writeData(data)
}

res.json({success:true})
})

app.listen(PORT,()=>{
console.log("Server running on port " + PORT)
})
