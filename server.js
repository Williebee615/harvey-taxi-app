const express = require("express")
const sqlite3 = require("sqlite3").verbose()
const path = require("path")

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(__dirname))

const db = new sqlite3.Database("taxi.db")

/* CREATE TABLES */

db.serialize(() => {

db.run(`
CREATE TABLE IF NOT EXISTS rides (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT,
phone TEXT,
pickup TEXT,
dropoff TEXT,
status TEXT DEFAULT 'waiting'
)
`)

db.run(`
CREATE TABLE IF NOT EXISTS drivers (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT,
phone TEXT,
email TEXT,
city TEXT,
state TEXT,
vehicle TEXT,
type TEXT
)
`)

})

/* REQUEST RIDE */

app.post("/request-ride", (req,res)=>{

const {name,phone,pickup,dropoff} = req.body

db.run(
"INSERT INTO rides (name,phone,pickup,dropoff) VALUES (?,?,?,?)",
[name,phone,pickup,dropoff],
(err)=>{
if(err){
res.status(500).send(err)
return
}

res.json({success:true})
}
)

})

/* GET RIDES */

app.get("/rides",(req,res)=>{

db.all("SELECT * FROM rides ORDER BY id DESC",[],(err,rows)=>{

if(err){
res.status(500).send(err)
return
}

res.json(rows)

})

})

/* DRIVER SIGNUP */

app.post("/driver-signup",(req,res)=>{

const {name,phone,email,city,state,vehicle,type} = req.body

db.run(
"INSERT INTO drivers (name,phone,email,city,state,vehicle,type) VALUES (?,?,?,?,?,?,?)",
[name,phone,email,city,state,vehicle,type],
(err)=>{
if(err){
res.status(500).send(err)
return
}

res.json({success:true})
}
)

})

/* GET DRIVERS */

app.get("/drivers",(req,res)=>{

db.all("SELECT * FROM drivers ORDER BY id DESC",[],(err,rows)=>{

if(err){
res.status(500).send(err)
return
}

res.json(rows)

})

})

/* START SERVER */

app.listen(PORT,()=>{

console.log("Harvey Taxi running on port " + PORT)

})
