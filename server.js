const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).send('Harvey Taxi API is running');
});

app.post('/request-ride', (req, res) => {
  console.log('Incoming ride request:', req.body);

  const { pickup, destination, passengerName, rideType } = req.body || {};

  if (!pickup || !destination || !passengerName || !rideType) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields',
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
    },
  });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
