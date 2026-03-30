const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

let rides = []

app.get('/', (req,res)=>{
res.sendFile(path.join(__dirname,'public/index.html'))
})

app.post('/request-ride',(req,res)=>{

const ride = {
id: Date.now(),
pickup: req.body.pickup,
dropoff: req.body.dropoff,
service: req.body.service,
status: "waiting"
}

rides.push(ride)

res.json({success:true,ride})

})

app.get('/rides',(req,res)=>{
res.json(rides)
})

app.post('/accept-ride',(req,res)=>{

const id = req.body.id

rides = rides.map(r=>{
if(r.id == id){
r.status = "accepted"
}
return r
})

res.json({success:true})

})

app.listen(PORT,()=>{
console.log("Harvey Taxi running on port " + PORT)
})
