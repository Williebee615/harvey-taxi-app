const express = require("express")
const cors = require("cors")
const fs = require("fs")
const path = require("path")
const axios = require("axios")

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())

/* ----------------------------------
WEBHOOK RAW BODY
---------------------------------- */

app.use("/webhook/persona", express.raw({ type: "*/*" }))
app.use("/webhook/checkr", express.raw({ type: "*/*" }))

app.use((req, res, next) => {
  if (req.path === "/webhook/persona" || req.path === "/webhook/checkr") {
    return next()
  }
  express.json()(req, res, next)
})

app.use(express.static(path.join(__dirname, "public")))

/* ----------------------------------
ENV
---------------------------------- */

const PERSONA_API_KEY = process.env.PERSONA_API_KEY || ""
const PERSONA_BASE_URL = "https://withpersona.com/api/v1"
const PERSONA_RIDER_TEMPLATE_ID = process.env.PERSONA_RIDER_TEMPLATE_ID || ""
const PERSONA_DRIVER_TEMPLATE_ID = process.env.PERSONA_DRIVER_TEMPLATE_ID || ""

const CHECKR_API_KEY = process.env.CHECKR_API_KEY || ""
const CHECKR_BASE_URL = "https://api.checkr.com/v1"
const CHECKR_PACKAGE = "Harvey Taxi Driver Check"

/* ----------------------------------
FILES
---------------------------------- */

const RIDERS_FILE = path.join(__dirname, "riders.json")
const DRIVERS_FILE = path.join(__dirname, "drivers.json")
const RIDES_FILE = path.join(__dirname, "rides.json")
const MESSAGES_FILE = path.join(__dirname, "messages.json")
const SUPPORT_FILE = path.join(__dirname, "support.json")

function ensure(file) {
if (!fs.existsSync(file)) fs.writeFileSync(file, "[]")
}

;[
RIDERS_FILE,
DRIVERS_FILE,
RIDES_FILE,
MESSAGES_FILE,
SUPPORT_FILE
].forEach(ensure)

function read(file){
return JSON.parse(fs.readFileSync(file))
}

function write(file,data){
fs.writeFileSync(file, JSON.stringify(data,null,2))
}

function uid(prefix="id"){
return prefix+"_"+Math.random().toString(36).slice(2,9)
}

/* ----------------------------------
PERSONA
---------------------------------- */

async function createPersona(templateId, ref){

const res = await axios.post(
`${PERSONA_BASE_URL}/inquiries`,
{
data:{
attributes:{
inquiry_template_id:templateId,
reference_id:ref
}
}
},
{
headers:{
Authorization:`Bearer ${PERSONA_API_KEY}`,
"Persona-Version":"2023-01-05"
}
}
)

return res.data.data
}

/* ----------------------------------
CHECKR
---------------------------------- */

async function createCheckr(driver){

const candidate = await axios.post(
`${CHECKR_BASE_URL}/candidates`,
{
first_name:driver.firstName,
last_name:driver.lastName,
email:driver.email
},
{
auth:{username:CHECKR_API_KEY,password:""}
}
)

const invite = await axios.post(
`${CHECKR_BASE_URL}/invitations`,
{
candidate_id:candidate.data.id,
package:CHECKR_PACKAGE
},
{
auth:{username:CHECKR_API_KEY,password:""}
}
)

return invite.data
}

/* ----------------------------------
RIDER SIGNUP
---------------------------------- */

app.post("/api/rider/signup", async (req,res)=>{

const rider = req.body
rider.id = uid("rider")
rider.status = "pending"

const inquiry = await createPersona(
PERSONA_RIDER_TEMPLATE_ID,
rider.id
)

rider.persona = inquiry.id
rider.personaUrl = inquiry.attributes.inquiry_link

const riders = read(RIDERS_FILE)
riders.push(rider)
write(RIDERS_FILE,riders)

res.json(rider)

})

/* ----------------------------------
DRIVER SIGNUP
---------------------------------- */

app.post("/api/driver/signup", async (req,res)=>{

const driver = req.body
driver.id = uid("driver")
driver.status = "persona_pending"

const inquiry = await createPersona(
PERSONA_DRIVER_TEMPLATE_ID,
driver.id
)

driver.persona = inquiry.id
driver.personaUrl = inquiry.attributes.inquiry_link

const drivers = read(DRIVERS_FILE)
drivers.push(driver)
write(DRIVERS_FILE,drivers)

res.json(driver)

})

/* ----------------------------------
PERSONA WEBHOOK
---------------------------------- */

app.post("/webhook/persona",(req,res)=>{

const event = JSON.parse(req.body.toString())

if(event.data.attributes.status==="completed"){

const ref = event.data.attributes.reference_id

const drivers = read(DRIVERS_FILE)
const d = drivers.find(x=>x.id===ref)

if(d){
d.status="checkr_pending"
write(DRIVERS_FILE,drivers)
createCheckr(d)
}

}

res.sendStatus(200)
})

/* ----------------------------------
CHECKR WEBHOOK
---------------------------------- */

app.post("/webhook/checkr",(req,res)=>{

const event = JSON.parse(req.body.toString())

if(event.type==="report.completed"){

const drivers = read(DRIVERS_FILE)

drivers.forEach(d=>{
d.status="approved"
})

write(DRIVERS_FILE,drivers)

}

res.sendStatus(200)
})

/* ----------------------------------
REQUEST RIDE
---------------------------------- */

app.post("/api/request-ride",(req,res)=>{

const ride = req.body

ride.id = uid("ride")
ride.status="searching"
ride.created = Date.now()

const rides = read(RIDES_FILE)
rides.push(ride)
write(RIDES_FILE,rides)

res.json(ride)

})

/* ----------------------------------
DRIVER STATUS
---------------------------------- */

app.post("/api/driver/status",(req,res)=>{

const {rideId,status} = req.body

const rides = read(RIDES_FILE)

const r = rides.find(x=>x.id===rideId)

if(r){
r.status=status
write(RIDES_FILE,rides)
}

res.json({ok:true})

})

/* ----------------------------------
RIDES
---------------------------------- */

app.get("/api/rides",(req,res)=>{
res.json(read(RIDES_FILE))
})

/* ----------------------------------
CHAT
---------------------------------- */

app.post("/api/chat/send",(req,res)=>{

const msg = req.body
msg.id = uid("msg")
msg.time = Date.now()

const msgs = read(MESSAGES_FILE)
msgs.push(msg)
write(MESSAGES_FILE,msgs)

res.json(msg)

})

app.get("/api/chat/:rideId",(req,res)=>{

const msgs = read(MESSAGES_FILE)
.filter(m=>m.rideId===req.params.rideId)

res.json(msgs)

})

/* ----------------------------------
AI SUPPORT
---------------------------------- */

app.post("/api/support",(req,res)=>{

const ticket = req.body

ticket.id = uid("support")
ticket.status="open"

const support = read(SUPPORT_FILE)
support.push(ticket)
write(SUPPORT_FILE,support)

res.json({
reply:"Support request received. Harvey AI is reviewing your issue."
})

})

/* ----------------------------------
ROOT
---------------------------------- */

app.get("/",(req,res)=>{
res.sendFile(path.join(__dirname,"public/index.html"))
})

app.listen(PORT,()=>{
console.log("Harvey Taxi AI Server Running")
})
