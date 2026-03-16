// Import express
const express = require('express');
const bodyParser = require('body-parser');

const app = express();

// Body Parser Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(__dirname));

// Routes
app.get('/request-ride', (req, res) => {
    res.sendFile(__dirname + '/request-ride.html');
});

// Other existing code...
