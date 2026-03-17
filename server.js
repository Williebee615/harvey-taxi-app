const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

/* Middleware */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* Serve HTML files */
app.use(express.static(path.join(__dirname)));

/* Database */
const db = new sqlite3.Database("taxi.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS rides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT,
      pickup TEXT,
      dropoff TEXT,
      status TEXT DEFAULT 'waiting'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT,
      car TEXT,
      status TEXT DEFAULT 'pending'
    )
  `);
});

/* Server check */
app.get("/", (req, res) => {
  res.send("Harvey Taxi Server Running");
});

/* Request Ride */
app.post("/request-ride", (req, res) => {
  const { name, phone, pickup, dropoff } = req.body;

  db.run(
    `INSERT INTO rides (name, phone, pickup, dropoff) VALUES (?, ?, ?, ?)`,
    [name, phone, pickup, dropoff],
    function (err) {
      if (err) {
        res.json({ success: false });
      } else {
        res.json({ success: true, rideId: this.lastID });
      }
    }
  );
});

/* Get rides (admin) */
app.get("/rides", (req, res) => {
  db.all("SELECT * FROM rides ORDER BY id DESC", (err, rows) => {
    res.json(rows);
  });
});

/* Driver signup */
app.post("/driver-signup", (req, res) => {
  const { name, phone, car } = req.body;

  db.run(
    `INSERT INTO drivers (name, phone, car) VALUES (?, ?, ?)`,
    [name, phone, car],
    function (err) {
      if (err) {
        res.json({ success: false });
      } else {
        res.json({ success: true });
      }
    }
  );
});

/* Start server */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
