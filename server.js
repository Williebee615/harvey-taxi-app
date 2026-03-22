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

// root
app.get('/', (req, res) => {
res.sendFile(path.join(__dirname, 'public/index.html'))
})

// dynamic fallback for all html pages
app.get('/:page', (req, res) => {
const file = path.join(__dirname, 'public', req.params.page)

if (fs.existsSync(file)) {
res.sendFile(file)
} else {
res.sendFile(path.join(__dirname, 'public/index.html'))
}
})

app.listen(PORT, () => {
console.log("Server running on port " + PORT)
})
