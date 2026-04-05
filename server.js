require("dotenv").config()

const express = require("express")
const path = require("path")
const cors = require("cors")

const app = express()

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname,"public")))


/* ===============================
   SECURE GOOGLE MAPS KEY ROUTE
================================ */

app.get("/api/maps-key",(req,res)=>{
res.json({
key: process.env.GOOGLE_MAPS_API_KEY
})
})


/* ===============================
   SERVER START
================================ */

const PORT = process.env.PORT || 10000

app.listen(PORT,()=>{
console.log("Harvey Taxi running on port",PORT)
})
