const express = require("express")
const cors = require("cors")
const path = require("path")

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, "public")))

/* =========================
   ADMIN EMAIL ACCESS
========================= */

const ADMIN_EMAILS = [
  "willieharvey813@gmail.com"
]

app.get("/api/admin/access", (req, res) => {
  const email = String(req.query.email || "").toLowerCase()

  const allowed = ADMIN_EMAILS.includes(email)

  res.json({
    success: true,
    allowed
  })
})

/* =========================
   ADMIN SHORT LINK
========================= */

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin-verification.html"))
})

/* =========================
   MEMORY
========================= */

global.driverSubmissions = global.driverSubmissions || []
global.approvedDrivers = global.approvedDrivers || []

/* =========================
   DRIVER VERIFY
========================= */

app.post("/api/driver/verify", (req, res) => {
  const submission = {
    id: Date.now().toString(),
    name: req.body.name,
    email: req.body.email,
    phone: req.body.phone,
    status: "pending"
  }

  global.driverSubmissions.push(submission)

  res.json({ success: true })
})

/* =========================
   ADMIN GET
========================= */

app.get("/api/admin/verifications", (req, res) => {
  res.json(global.driverSubmissions)
})

/* =========================
   APPROVE DRIVER
========================= */

app.post("/api/admin/approve/:id", (req, res) => {
  const driver = global.driverSubmissions.find(
    d => d.id === req.params.id
  )

  if (!driver) {
    return res.json({ success: false })
  }

  driver.status = "approved"
  global.approvedDrivers.push(driver)

  res.json({ success: true })
})

/* =========================
   DRIVER CHECK
========================= */

app.post("/api/driver/check", (req, res) => {
  const driver = global.approvedDrivers.find(
    d => d.email === req.body.email
  )

  res.json({
    approved: !!driver
  })
})

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log("Harvey Taxi running on port " + PORT)
})
