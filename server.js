const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Serve static files from current folder
app.use(express.static(__dirname));

// Home route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
});

// Optional extra routes if you want other pages later
app.get('/driver', (req, res) => {
  res.sendFile(path.join(__dirname, 'driver.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/request-ride', (req, res) => {
  res.sendFile(path.join(__dirname, 'request-ride.html'));
});

app.get('/verification', (req, res) => {
  res.sendFile(path.join(__dirname, 'verification.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
