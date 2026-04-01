const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())

// serve public folder
app.use(express.static(path.join(__dirname, 'public')))

// homepage
app.get('/', (req, res) => {
res.sendFile(path.join(__dirname, 'public/index.html'))
})

// privacy page
app.get('/privacy', (req, res) => {
res.sendFile(path.join(__dirname, 'public/privacy.html'))
})

// fallback
app.get('*', (req, res) => {
res.sendFile(path.join(__dirname, 'public/index.html'))
})

app.listen(PORT, () => {
console.log('Harvey Taxi running on port ' + PORT)
})
