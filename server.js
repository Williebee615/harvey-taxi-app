const express = require('express')
const cors = require('cors')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())

function read(file){
try{
return JSON.parse(fs.readFileSync(file,'utf8'))
}catch{
return []
}
}

function write(file,data){
fs.writeFileSync(file,JSON.stringify(data,null,2))
}

app.get('/',(req,res)=>{
res.send('Harvey Taxi Running')
})

app.get('/api/status',(req,res)=>{
res.json({status:'ok'})
})

app.get('/api/rides',(req,res)=>{
res.json(read('rides.json'))
})

app.post('/api/request-ride',(req,res)=>{

const rides = read('rides.json')

const ride = {
id:Date.now(),
pickup:req.body.pickup || '',
dropoff:req.body.dropoff || '',
status:'waiting'
}

rides.push(ride)

write('rides.json',rides)

res.json({success:true})

})

app.listen(PORT,()=>{
console.log('SERVER STARTED')
})
