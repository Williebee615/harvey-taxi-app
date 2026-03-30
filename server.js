require('dotenv').config()

const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const Stripe = require('stripe')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const DATA_FILE = path.join(__dirname, 'data.json')

function loadData() {
if (!fs.existsSync(DATA_FILE)) {
return { drivers: [], rides: [], payments: [] }
}
return JSON.parse(fs.readFileSync(DATA_FILE))
}

function saveData(data) {
fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

app.get('/', (req,res)=>{
res.sendFile(path.join(__dirname,'public/index.html'))
})

/* ===============================
REGISTER DRIVER
================================ */
app.post('/api/drivers/register',(req,res)=>{
const { id, name } = req.body

const data = loadData()

data.drivers.push({
id,
name,
wallet:0
})

saveData(data)

res.send({success:true})
})

/* ===============================
ADD DRIVER EARNINGS
================================ */
app.post('/api/driver/add-earnings',(req,res)=>{
const { driverId, amount } = req.body

const data = loadData()

const driver = data.drivers.find(d=>d.id===driverId)

if(!driver){
return res.status(404).send('Driver not found')
}

driver.wallet += Number(amount)

saveData(data)

res.send({
success:true,
wallet:driver.wallet
})
})

/* ===============================
GET DRIVER WALLET
================================ */
app.get('/api/driver/wallet/:driverId',(req,res)=>{

const data = loadData()

const driver = data.drivers.find(
d=>d.id===req.params.driverId
)

res.send({
wallet: driver?.wallet || 0
})

})

/* ===============================
STRIPE PAYMENT (RIDER PAYS)
================================ */
app.post('/api/payments/create', async (req,res)=>{
try{

const { amount, driverId } = req.body

const data = loadData()

const driver = data.drivers.find(d=>d.id===driverId)

const platformFee = Math.round(amount * .20)

const paymentIntent = await stripe.paymentIntents.create({
amount: amount * 100,
currency:'usd'
})

driver.wallet += (amount - platformFee)

saveData(data)

res.send({
clientSecret: paymentIntent.client_secret
})

}catch(err){
res.status(500).send(err.message)
}
})

/* ===============================
INSTANT DRIVER PAYOUT
================================ */
app.post('/api/driver/payout', async (req,res)=>{
try{

const { amount, stripeAccount } = req.body

const transfer = await stripe.transfers.create({
amount: amount * 100,
currency:'usd',
destination: stripeAccount
})

res.send({
success:true,
transfer
})

}catch(err){
res.status(500).send(err.message)
}
})

/* ===============================
HEALTH
================================ */
app.get('/health',(req,res)=>{
res.send('Harvey Taxi Running')
})

app.listen(PORT,()=>{
console.log('Harvey Taxi Server Running')
})
