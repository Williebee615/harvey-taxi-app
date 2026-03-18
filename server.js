const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the project root
app.use(express.static(__dirname));

// Main rider home screen
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
});

// Other pages
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

// Health check route
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    app: 'Harvey Taxi',
    port: PORT,
  });
});

// Start server using Render's required port
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
