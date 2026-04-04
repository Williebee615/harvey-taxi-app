const { createClient } = require("@supabase/supabase-js")
const express = require("express")
const cors = require("cors")
const path = require("path")

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))

/* -------------------------------
   SUPABASE
--------------------------------*/

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
)

/* -------------------------------
   HELPERS
--------------------------------*/

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

function now() {
  return new Date().toISOString()
}

/* -------------------------------
   STATUS
--------------------------------*/

app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    server: "Harvey Taxi Phase 1",
    time: now()
  })
})

/* -------------------------------
   DRIVER SIGNUP
--------------------------------*/

app.post("/api/driver/signup", async (req, res) => {
  try {
    const driver = {
      id: uid("driver"),
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      vehicle: req.body.vehicle,
      status: "pending",
      approved: false,
      available: false,
      created_at: now()
    }

    const { data, error } = await supabase
      .from("drivers")
      .insert([driver])
      .select()

    if (error) throw error

    res.json(data[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* -------------------------------
   RIDER SIGNUP
--------------------------------*/

app.post("/api/rider/signup", async (req, res) => {
  try {
    const rider = {
      id: uid("rider"),
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      created_at: now()
    }

    const { data, error } = await supabase
      .from("riders")
      .insert([rider])
      .select()

    if (error) throw error

    res.json(data[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* -------------------------------
   REQUEST RIDE
--------------------------------*/

app.post("/api/request-ride", async (req, res) => {
  try {
    const ride = {
      id: uid("ride"),
      rider_name: req.body.name,
      phone: req.body.phone,
      pickup: req.body.pickup,
      dropoff: req.body.dropoff,
      status: "searching",
      created_at: now()
    }

    const { data, error } = await supabase
      .from("rides")
      .insert([ride])
      .select()

    if (error) throw error

    res.json({
      success: true,
      ride: data[0]
    })

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* -------------------------------
   GET RIDES
--------------------------------*/

app.get("/api/rides", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) throw error

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* -------------------------------
   DRIVER ACCEPT RIDE
--------------------------------*/

app.post("/api/driver/accept", async (req, res) => {
  try {
    const { rideId, driverId } = req.body

    const { data, error } = await supabase
      .from("rides")
      .update({
        driver_id: driverId,
        status: "assigned"
      })
      .eq("id", rideId)
      .select()

    if (error) throw error

    res.json(data[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* -------------------------------
   DRIVER UPDATE STATUS
--------------------------------*/

app.post("/api/driver/status", async (req, res) => {
  try {
    const { rideId, status } = req.body

    const { data, error } = await supabase
      .from("rides")
      .update({ status })
      .eq("id", rideId)
      .select()

    if (error) throw error

    res.json(data[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* -------------------------------
   GPS UPDATE
--------------------------------*/

app.post("/api/gps", async (req, res) => {
  try {
    const { driverId, lat, lng } = req.body

    const { error } = await supabase
      .from("gps")
      .upsert([
        {
          driver_id: driverId,
          lat,
          lng,
          updated_at: now()
        }
      ])

    if (error) throw error

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* -------------------------------
   ROOT
--------------------------------*/

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"))
})

/* -------------------------------
   START SERVER
--------------------------------*/

app.listen(PORT, () => {
  console.log("Harvey Taxi Phase 1 running on port " + PORT)
})
