app.post('/api/persona/driver', async (req, res) => {
try {

const { name, email } = req.body

const response = await axios.post(
'https://api.withpersona.com/api/v1/inquiries',
{
data: {
attributes: {
template_id: process.env.PERSONA_TEMPLATE_ID_DRIVER,
reference_id: email,
name_first: name
}
}
},
{
headers: {
Authorization: `Bearer ${process.env.PERSONA_API_KEY}`,
'Content-Type': 'application/json'
}
}
)

const inquiry = response.data.data

res.json({
url: inquiry.attributes.inquiry_url
})

} catch (err) {
console.log(err.response?.data || err.message)
res.status(500).json({ error: 'Persona launch failed' })
}
})const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const axios = require('axios')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())

app.use(express.static(path.join(__dirname, 'public')))

const DATA_FILE = './data.json'

function loadData() {
if (!fs.existsSync(DATA_FILE)) {
fs.writeFileSync(DATA_FILE, JSON.stringify({
users: [],
sessions: []
}, null, 2))
}
return JSON.parse(fs.readFileSync(DATA_FILE))
}

function saveData(data) {
fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function generateId() {
return Math.random().toString(36).substring(2) + Date.now()
}

function generateToken() {
return Math.random().toString(36).substring(2)
}

app.get('/', (req, res) => {
res.sendFile(path.join(__dirname, 'public/index.html'))
})

/* =========================
RIDER SIGNUP
========================= */
app.post('/api/signup/rider', async (req, res) => {
const { name, email, password } = req.body

const data = loadData()

const user = {
id: generateId(),
name,
email,
password,
role: 'rider',
approved: true,
personaStatus: 'pending'
}

data.users.push(user)
saveData(data)

res.json({
success: true,
user
})
})

/* =========================
DRIVER SIGNUP
========================= */
app.post('/api/signup/driver', async (req, res) => {
const { name, email, password } = req.body

const data = loadData()

const user = {
id: generateId(),
name,
email,
password,
role: 'driver',
approved: false,
personaStatus: 'pending',
checkrStatus: 'pending'
}

data.users.push(user)
saveData(data)

res.json({
success: true,
user
})
})

/* =========================
LOGIN
========================= */
app.post('/api/login', (req, res) => {
const { email, password } = req.body

const data = loadData()

const user = data.users.find(
u => u.email === email && u.password === password
)

if (!user) {
return res.status(401).json({
error: 'Invalid credentials'
})
}

const token = generateToken()

data.sessions.push({
token,
userId: user.id
})

saveData(data)

res.json({
token,
user
})
})

/* =========================
AUTH MIDDLEWARE
========================= */
function auth(req, res, next) {
const token = req.headers.authorization

if (!token) return res.status(401).send()

const data = loadData()

const session = data.sessions.find(s => s.token === token)

if (!session) return res.status(401).send()

req.user = data.users.find(u => u.id === session.userId)

next()
}

/* =========================
GET PROFILE
========================= */
app.get('/api/me', auth, (req, res) => {
res.json(req.user)
})

/* =========================
PERSONA VERIFY
========================= */
app.post('/api/persona/start', auth, async (req, res) => {
try {

const templateId = req.user.role === 'driver'
? process.env.PERSONA_DRIVER_TEMPLATE
: process.env.PERSONA_RIDER_TEMPLATE

res.json({
url: `https://withpersona.com/verify?template-id=${templateId}&reference-id=${req.user.id}`
})

} catch (e) {
res.status(500).json({ error: 'persona error' })
}
})

/* =========================
PERSONA WEBHOOK
========================= */
app.post('/webhook/persona', (req, res) => {
const event = req.body

const data = loadData()

const user = data.users.find(
u => u.id === event.data.attributes.reference_id
)

if (!user) return res.sendStatus(200)

user.personaStatus = 'approved'

if (user.role === 'rider') {
user.approved = true
}

saveData(data)

res.sendStatus(200)
})

/* =========================
CHECKR START
========================= */
app.post('/api/checkr/start', auth, async (req, res) => {

if (req.user.role !== 'driver')
return res.status(403).send()

req.user.checkrStatus = 'pending'

const data = loadData()
saveData(data)

res.json({
success: true
})
})

/* =========================
CHECKR WEBHOOK
========================= */
app.post('/webhook/checkr', (req, res) => {
const event = req.body

const data = loadData()

const user = data.users.find(
u => u.id === event.userId
)

if (!user) return res.sendStatus(200)

user.checkrStatus = 'approved'

if (user.personaStatus === 'approved') {
user.approved = true
}

saveData(data)

res.sendStatus(200)
})

/* =========================
DRIVER STATUS
========================= */
app.get('/api/driver/status', auth, (req, res) => {

if (req.user.role !== 'driver')
return res.send()

res.json({
approved: req.user.approved,
persona: req.user.personaStatus,
checkr: req.user.checkrStatus
})
})

app.listen(PORT, () => {
console.log('Server running on port ' + PORT)
})
