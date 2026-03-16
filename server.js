const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const db = new sqlite3.Database("./rides.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS rides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT,
      pickup TEXT,
      dropoff TEXT,
      status TEXT DEFAULT 'requested',
      acceptedBy TEXT DEFAULT '',
      time TEXT
    )
  `);
});

app.get("/", (req,res)=>{
  res.sendFile(path.join(__dirname,"request-ride.html"));
});

app.post("/request-ride",(req,res)=>{

  const {name,phone,pickup,dropoff} = req.body
  const time = new Date().toLocaleString()

  db.run(
    `INSERT INTO rides (name,phone,pickup,dropoff,status,acceptedBy,time)
     VALUES (?,?,?,?, 'requested','',?)`,
    [name,phone,pickup,dropoff,time],
    function(err){

      if(err){
        console.error(err)
        return res.status(500).json({success:false})
      }

      res.json({
        success:true,
        rideId:this.lastID
      })

    }
  )

})

app.get("/rides",(req,res)=>{

  db.all(`SELECT * FROM rides ORDER BY id DESC`,(err,rows)=>{

    if(err){
      console.error(err)
      return res.status(500).json([])
    }

    res.json(rows)

  })

})

app.post("/accept/:id",(req,res)=>{

  const rideId = req.params.id
  const driverName = req.body.driverName || "Driver"

  db.get(`SELECT * FROM rides WHERE id=?`,[rideId],(err,ride)=>{

    if(!ride){
      return res.json({success:false,message:"Ride not found"})
    }

    if(ride.status !== "requested"){
      return res.json({
        success:false,
        message:"Ride already accepted by "+ride.acceptedBy
      })
    }

    db.run(
      `UPDATE rides SET status='accepted', acceptedBy=? WHERE id=?`,
      [driverName,rideId],
      function(err){

        if(err){
          return res.json({success:false})
        }

        res.json({
          success:true,
          message:"Ride accepted"
        })

      }
    )

  })

})

app.post("/complete/:id",(req,res)=>{

  const rideId = req.params.id

  db.run(
    `UPDATE rides SET status='completed' WHERE id=?`,
    [rideId],
    function(err){

      if(err){
        return res.json({success:false})
      }

      res.json({success:true})

    }
  )

})

app.listen(PORT,()=>{
  console.log("🚕 Harvey Taxi server running on port "+PORT)
})
