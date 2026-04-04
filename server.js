const express = require("express")
const cors = require("cors")
const fs = require("fs")
const path = require("path")
const axios = require("axios")

const app = express()
app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 10000

/* -----------------------------
   ENV
----------------------------- */

const PERSONA_API_KEY = process.env.PERSONA_API_KEY
const PERSONA_RIDER_TEMPLATE_ID = process.env.PERSONA_RIDER_TEMPLATE_ID
const PERSONA_DRIVER_TEMPLATE_ID = process.env.PERSONA_DRIVER_TEMPLATE_ID

const CHECKR_API_KEY = process.env.CHECKR_API_KEY
const CHECKR_PACKAGE = process.env.CHECKR_PACKAGE || "driver_pro"

/* -----------------------------
   STORAGE
----------------------------- */

const ridersFile = "./riders.json"
const driversFile = "./drivers.json"

function read(file) {
if (!fs.existsSync(file)) return []
return JSON.parse(fs.readFileSync(file))
}

function write(file, data) {
fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

/* -----------------------------
   PERSONA CREATE
----------------------------- */

async function createPersonaInquiry(templateId, referenceId) {
const res = await axios.post(
"https://api.withpersona.com/api/v1/inquiries",
{
data: {
attributes: {
inquiry_template_id: templateId,
reference_id: referenceId
}
}
},
{
headers: {
Authorization: `Bearer ${PERSONA_API_KEY}`,
"Persona-Version": "2023-01-05"
}
}
)

return res.data.data
}

/* -----------------------------
   CHECKR CREATE
----------------------------- */

async function createCheckrCandidate(driver) {

const candidate = await axios.post(
"https://api.checkr.com/v1/candidates",
{
first_name: driver.firstName,
last_name: driver.lastName,
email: driver.email,
work_locations: [
{
country: "US"
}
]
},
{
auth: {
username: CHECKR_API_KEY,
password: ""
}
}
)

const invitation = await axios.post(
"https://api.checkr.com/v1/invitations",
{
candidate_id: candidate.data.id,
package: CHECKR_PACKAGE
},
{
auth: {
username: CHECKR_API_KEY,
password: ""
}
}
)

return invitation.data
}

/* -----------------------------
   RIDER SIGNUP
----------------------------- */

app.post("/api/rider-signup", async (req, res) => {

const riders = read(ridersFile)

const rider = {
id: "rider_" + Date.now(),
name: req.body.name,
email: req.body.email,
phone: req.body.phone,
personaStatus: "pending",
approved: false
}

riders.push(rider)
write(ridersFile, riders)

try {

const inquiry = await createPersonaInquiry(
PERSONA_RIDER_TEMPLATE_ID,
rider.id
)

rider.personaInquiryId = inquiry.id
rider.personaLink = inquiry.attributes?.inquiry_url

write(ridersFile, riders)

res.json({
success: true,
verifyUrl: rider.personaLink
})

} catch (e) {
console.log(e.message)
res.status(500).json({ error: "persona error" })
}

})

/* -----------------------------
   DRIVER SIGNUP
----------------------------- */

app.post("/api/driver-signup", async (req, res) => {

const drivers = read(driversFile)

const driver = {
id: "driver_" + Date.now(),
firstName: req.body.firstName,
lastName: req.body.lastName,
email: req.body.email,
phone: req.body.phone,
personaStatus: "pending",
checkrStatus: "pending",
approved: false,
available: false
}

drivers.push(driver)
write(driversFile, drivers)

try {

const inquiry = await createPersonaInquiry(
PERSONA_DRIVER_TEMPLATE_ID,
driver.id
)

driver.personaInquiryId = inquiry.id
driver.personaLink = inquiry.attributes?.inquiry_url

write(driversFile, drivers)

res.json({
success: true,
verifyUrl: driver.personaLink
})

} catch (e) {
console.log(e.message)
res.status(500).json({ error: "persona error" })
}

})

/* -----------------------------
   PERSONA WEBHOOK
----------------------------- */

app.post("/webhook/persona", async (req, res) => {

const event = req.body

if (event.data?.attributes?.status !== "completed") {
return res.sendStatus(200)
}

const inquiry = event.data
const referenceId = inquiry.attributes.reference_id

/* rider */
let riders = read(ridersFile)
let rider = riders.find(r => r.id === referenceId)

if (rider) {
rider.personaStatus = "approved"
rider.approved = true
write(ridersFile, riders)
return res.sendStatus(200)
}

/* driver */
let drivers = read(driversFile)
let driver = drivers.find(d => d.id === referenceId)

if (driver) {

driver.personaStatus = "approved"
write(driversFile, drivers)

/* start checkr */
try {

const invitation = await createCheckrCandidate(driver)

driver.checkrInvitationId = invitation.id
driver.checkrStatus = "running"

write(driversFile, drivers)

} catch (e) {
console.log(e.message)
}

}

res.sendStatus(200)

})

/* -----------------------------
   CHECKR WEBHOOK
----------------------------- */

app.post("/webhook/checkr", (req, res) => {

const data = req.body

if (!data.data) return res.sendStatus(200)

const invitation = data.data

let drivers = read(driversFile)

let driver = drivers.find(
d => d.checkrInvitationId === invitation.id
)

if (!driver) return res.sendStatus(200)

if (invitation.attributes.status === "completed") {

driver.checkrStatus = "clear"
driver.approved = true
driver.available = true

write(driversFile, drivers)

}

res.sendStatus(200)

})

/* -----------------------------
   GET DRIVERS
----------------------------- */

app.get("/api/drivers", (req, res) => {
res.json(read(driversFile))
})

/* -----------------------------
   GET RIDERS
----------------------------- */

app.get("/api/riders", (req, res) => {
res.json(read(ridersFile))
})

/* ----------------------------- */

app.listen(PORT, () =>
console.log("Harvey Taxi server running")
)
