const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
});

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

app.get('/health', (req, res) => {
  res.json({ ok: true, app: 'Harvey Taxi' });
});

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`);
});
