const express = require("express");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
});

app.get("/", (req, res) => {
  res.send("Harvey Taxi Server Running");
});

app.listen(PORT, () => {
  console.log("Harvey Taxi running on port " + PORT);
});
