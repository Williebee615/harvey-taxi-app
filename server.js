const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database("./rides.db");

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS rides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    phone TEXT,
    pickup TEXT,
    dropoff TEXT,
    status TEXT
  )`);
});

app.post("/request-ride", (req, res) => {
  const { name, phone, pickup, dropoff } = req.body;

  db.run(
    "INSERT INTO rides (name, phone, pickup, dropoff, status) VALUES (?, ?, ?, ?, ?)",
    [name, phone, pickup, dropoff, "waiting"],
    function (err) {
      if (err) {
        return res.status(500).send("Error saving ride");
      }

      const ride = {
        id: this.lastID,
        name,
        phone,
        pickup,
        dropoff,
        status: "waiting"
      };

      io.emit("newRide", ride);

      res.json({ success: true });
    }
  );
});

app.get("/rides", (req, res) => {
  db.all("SELECT * FROM rides", [], (err, rows) => {
    res.json(rows);
  });
});

app.post("/accept-ride/:id", (req, res) => {
  const id = req.params.id;

  db.run("UPDATE rides SET status='accepted' WHERE id=?", [id], () => {
    io.emit("rideAccepted", id);
    res.json({ success: true });
  });
});

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log("🚕 Harvey Taxi server running on port " + PORT);
});
