const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/request-ride', (req, res) => {
  res.sendFile(path.join(__dirname, 'request-ride.html'));
});

app.post('/request-ride', (req, res) => {
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
