/* =========================
   ADMIN EMAIL ACCESS
========================= */

const ADMIN_EMAILS = [
  'willieharvey813@gmail.com'
]

app.get('/api/admin/access', (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase()

  if (!email) {
    return res.json({
      success: false,
      allowed: false,
      message: 'Email is required'
    })
  }

  const allowed = ADMIN_EMAILS.includes(email)

  res.json({
    success: true,
    allowed
  })
})

/* =========================
   ADMIN SHORT LINK
========================= */

app.get('/admin', (req, res) => {
  res.redirect('/admin-verification.html')
})const express = require("express")
const cors = require("cors")
const path = require("path")
const multer = require("multer")

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static("public"))

/* =========================
   PERSISTENT MEMORY
========================= */

global.driverSubmissions = global.driverSubmissions || []
global.approvedDrivers = global.approvedDrivers || []
global.onlineDrivers = global.onlineDrivers || []

/* =========================
   FILE UPLOAD
========================= */

const storage = multer.memoryStorage()
const upload = multer({ storage: storage })

/* =========================
   DRIVER VERIFICATION SUBMIT
========================= */

app.post(
  "/api/driver/verify",
  upload.fields([
    { name: "license" },
    { name: "selfie" },
    { name: "vehicle" },
  ]),
  (req, res) => {
    const { name, email, phone } = req.body

    const submission = {
      id: Date.now(),
      name,
      email,
      phone,
      license: req.files.license?.[0]?.originalname,
      selfie: req.files.selfie?.[0]?.originalname,
      vehicle: req.files.vehicle?.[0]?.originalname,
      status: "pending",
    }

    global.driverSubmissions.push(submission)

    res.json({
      success: true,
      message: "Verification submitted",
    })
  }
)

/* =========================
   ADMIN GET SUBMISSIONS
========================= */

app.get("/api/admin/submissions", (req, res) => {
  res.json(global.driverSubmissions)
})

/* =========================
   APPROVE DRIVER
========================= */

app.post("/api/admin/approve/:id", (req, res) => {
  const id = Number(req.params.id)

  const driver = global.driverSubmissions.find(d => d.id === id)

  if (!driver) {
    return res.status(404).json({ error: "Not found" })
  }

  driver.status = "approved"
  global.approvedDrivers.push(driver)

  res.json({ success: true })
})

/* =========================
   DRIVER ACCESS CHECK
========================= */

app.post("/api/driver/check", (req, res) => {
  const { email } = req.body

  const driver = global.approvedDrivers.find(
    d => d.email.toLowerCase() === email.toLowerCase()
  )

  if (!driver) {
    return res.json({
      approved: false,
    })
  }

  res.json({
    approved: true,
    driver,
  })
})

/* =========================
   DRIVER GO ONLINE
========================= */

app.post("/api/driver/online", (req, res) => {
  const { email } = req.body

  const driver = global.approvedDrivers.find(d => d.email === email)

  if (!driver) return res.json({ success: false })

  driver.online = true
  global.onlineDrivers.push(driver)

  res.json({ success: true })
})

/* =========================
   GET ONLINE DRIVERS
========================= */

app.get("/api/drivers/online", (req, res) => {
  res.json(global.onlineDrivers)
})

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log("Server running on port", PORT)
})
