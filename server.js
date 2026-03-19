const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(__dirname));

// Home route
app.get('/', (req, res) => {
  res.status(200).send('Harvey Taxi API is running');
});

// Ride request API
app.post('/request-ride', (req, res) => {
  console.log('Incoming ride request:', req.body);

  const { pickup, destination, passengerName, rideType } = req.body;

  if (!pickup || !destination || !passengerName || !rideType) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields'
    });
  }

  return res.status(200).json({
    success: true,
    message: 'Ride received successfully',
    ride: {
      pickup,
      destination,
      passengerName,
      rideType,
      status: 'pending'
    }
  });
});

// Optional page routes
app.get('/request-ride-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'request-ride.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
