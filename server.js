const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

let rides = []; // In-memory storage for rides

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', time: new Date() });
});

// Ride request endpoint
app.post('/ride/request', (req, res) => {
    const { riderName, destination } = req.body;
    const newRide = { id: rides.length + 1, riderName, destination, status: 'requested' };
    rides.push(newRide);
    res.status(201).json(newRide);
});

// Get all rides endpoint
app.get('/rides', (req, res) => {
    res.json(rides);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
