const express = require("express");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const db = new sqlite3.Database("taxi.db");

let driverLocations = [];

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS rides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT,
      pickup TEXT,
      dropoff TEXT,
      status TEXT DEFAULT 'waiting',
      acceptedBy TEXT DEFAULT '',
      fare REAL DEFAULT 0,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT,
      email TEXT,
      city TEXT,
      state TEXT,
      vehicle TEXT,
      type TEXT,
      status TEXT DEFAULT 'pending',
      earnings REAL DEFAULT 0,
      password TEXT DEFAULT '1234',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      baseFare REAL DEFAULT 5,
      perMile REAL DEFAULT 2
    )
  `);

  db.run(`
    INSERT OR IGNORE INTO settings (id, baseFare, perMile)
    VALUES (1, 5, 2)
  `);

  db.run(`ALTER TABLE rides ADD COLUMN fare REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE rides ADD COLUMN createdAt TEXT DEFAULT CURRENT_TIMESTAMP`, () => {});
  db.run(`ALTER TABLE drivers ADD COLUMN status TEXT DEFAULT 'pending'`, () => {});
  db.run(`ALTER TABLE drivers ADD COLUMN earnings REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE drivers ADD COLUMN password TEXT DEFAULT '1234'`, () => {});
  db.run(`ALTER TABLE drivers ADD COLUMN createdAt TEXT DEFAULT CURRENT_TIMESTAMP`, () => {});
});

function estimateFare(pickup, dropoff) {
  const baseFare = 5;
  const distanceHint = Math.max(1, Math.ceil((pickup.length + dropoff.length) / 20));
  return Number((baseFare + distanceHint * 2).toFixed(2));
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function parseLatLng(pickup) {
  if (!pickup || typeof pickup !== "string") return null;

  const parts = pickup.split(",");
  if (parts.length < 2) return null;

  const lat = Number(parts[0].trim());
  const lng = Number(parts[1].trim());

  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

  return { lat, lng };
}

function findClosestApprovedDriver(pickupText, approvedDrivers) {
  const pickupCoords = parseLatLng(pickupText);
  if (!pickupCoords) return null;

  const onlineApprovedDrivers = approvedDrivers.filter((driver) =>
    driverLocations.some((loc) => loc.name === driver.name)
  );

  if (!onlineApprovedDrivers.length) return null;

  let closest = null;
  let closestDistance = Infinity;

  onlineApprovedDrivers.forEach((driver) => {
    const loc = driverLocations.find((d) => d.name === driver.name);
    if (!loc) return;

    const miles = distanceMiles(pickupCoords.lat, pickupCoords.lng, loc.lat, loc.lng);

    if (miles < closestDistance) {
      closestDistance = miles;
      closest = {
        name: driver.name,
        distanceMiles: Number(miles.toFixed(2))
      };
    }
  });

  return closest;
}

/* RIDES */

app.post("/request-ride", (req, res) => {
  const { name, phone, pickup, dropoff } = req.body;

  if (!name || !phone || !pickup || !dropoff) {
    return res.status(400).json({ success: false, error: "Missing ride fields" });
  }

  const fare = estimateFare(pickup, dropoff);

  db.all(
    "SELECT * FROM drivers WHERE status = 'approved'",
    [],
    (driverErr, approvedDrivers) => {
      if (driverErr) {
        return res.status(500).json({ success: false, error: driverErr.message });
      }

      const closestDriver = findClosestApprovedDriver(pickup, approvedDrivers);
      const assignedDriver = closestDriver ? closestDriver.name : "";
      const assignedStatus = closestDriver ? "accepted" : "waiting";

      db.run(
        `INSERT INTO rides (name, phone, pickup, dropoff, status, acceptedBy, fare)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name, phone, pickup, dropoff, assignedStatus, assignedDriver, fare],
        function (err) {
          if (err) return res.status(500).json({ success: false, error: err.message });

          res.json({
            success: true,
            rideId: this.lastID,
            fare,
            autoAssigned: !!closestDriver,
            assignedDriver: assignedDriver || null
          });
        }
      );
    }
  );
});

app.get("/rides", (req, res) => {
  db.all("SELECT * FROM rides ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json(rows);
  });
});

app.post("/accept-ride/:id", (req, res) => {
  const rideId = req.params.id;
  const { driverName } = req.body;

  if (!driverName) {
    return res.status(400).json({ success: false, error: "Driver name required" });
  }

  db.run(
    `UPDATE rides
     SET status = 'accepted', acceptedBy = ?
     WHERE id = ? AND status = 'waiting'`,
    [driverName, rideId],
    function (err) {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: this.changes > 0 });
    }
  );
});

app.post("/complete-ride/:id", (req, res) => {
  const rideId = req.params.id;

  db.get("SELECT * FROM rides WHERE id = ?", [rideId], (err, ride) => {
    if (err || !ride) {
      return res.status(404).json({ success: false, error: "Ride not found" });
    }

    db.run(
      "UPDATE rides SET status = 'completed' WHERE id = ?",
      [rideId],
      (updateErr) => {
        if (updateErr) return res.status(500).json({ success: false, error: updateErr.message });

        if (ride.acceptedBy) {
          db.run(
            "UPDATE drivers SET earnings = earnings + ? WHERE name = ?",
            [Number((ride.fare || 0) * 0.8), ride.acceptedBy],
            () => {
              res.json({ success: true });
            }
          );
        } else {
          res.json({ success: true });
        }
      }
    );
  });
});

/* DRIVER SIGNUP + LOGIN */

app.post("/driver-signup", (req, res) => {
  const { name, phone, email, city, state, vehicle, type, password } = req.body;

  if (!name || !phone || !email || !city || !state || !vehicle || !type) {
    return res.status(400).json({ success: false, error: "Missing driver fields" });
  }

  db.run(
    `INSERT INTO drivers (name, phone, email, city, state, vehicle, type, status, earnings, password)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
    [name, phone, email, city, state, vehicle, type, password || "1234"],
    function (err) {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, driverId: this.lastID });
    }
  );
});

app.post("/driver-login", (req, res) => {
  const { phone, password } = req.body;

  db.get(
    "SELECT * FROM drivers WHERE phone = ? AND password = ?",
    [phone, password],
    (err, driver) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      if (!driver) return res.status(401).json({ success: false, error: "Invalid login" });
      if (driver.status !== "approved") {
        return res.status(403).json({ success: false, error: "Driver not approved yet" });
      }
      res.json({ success: true, driver });
    }
  );
});

app.get("/drivers", (req, res) => {
  db.all("SELECT * FROM drivers ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json(rows);
  });
});

app.post("/approve-driver/:id", (req, res) => {
  db.run(
    "UPDATE drivers SET status = 'approved' WHERE id = ?",
    [req.params.id],
    function (err) {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: this.changes > 0 });
    }
  );
});

app.post("/reject-driver/:id", (req, res) => {
  db.run(
    "UPDATE drivers SET status = 'rejected' WHERE id = ?",
    [req.params.id],
    function (err) {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: this.changes > 0 });
    }
  );
});

/* DRIVER LOCATIONS */

app.post("/driver-location", (req, res) => {
  const { name, lat, lng } = req.body;

  if (!name || lat === undefined || lng === undefined) {
    return res.status(400).json({ success: false, error: "Missing location data" });
  }

  const parsedLat = Number(lat);
  const parsedLng = Number(lng);

  if (Number.isNaN(parsedLat) || Number.isNaN(parsedLng)) {
    return res.status(400).json({ success: false, error: "Invalid coordinates" });
  }

  const existing = driverLocations.find((d) => d.name === name);

  if (existing) {
    existing.lat = parsedLat;
    existing.lng = parsedLng;
    existing.updatedAt = Date.now();
  } else {
    driverLocations.push({
      name,
      lat: parsedLat,
      lng: parsedLng,
      updatedAt: Date.now()
    });
  }

  res.json({ success: true });
});

app.get("/driver-locations", (req, res) => {
  const now = Date.now();
  driverLocations = driverLocations.filter((d) => now - d.updatedAt < 60000);
  res.json(driverLocations);
});

/* ANALYTICS */

app.get("/analytics", (req, res) => {
  db.get(
    `SELECT
      COUNT(*) AS totalRides,
      SUM(CASE WHEN status='waiting' THEN 1 ELSE 0 END) AS waitingRides,
      SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) AS acceptedRides,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completedRides,
      COALESCE(SUM(fare),0) AS grossRevenue
     FROM rides`,
    [],
    (err, rideStats) => {
      if (err) return res.status(500).json({ success: false, error: err.message });

      db.get(
        `SELECT
          COUNT(*) AS totalDrivers,
          SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pendingDrivers,
          SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approvedDrivers
         FROM drivers`,
        [],
        (driverErr, driverStats) => {
          if (driverErr) return res.status(500).json({ success: false, error: driverErr.message });

          res.json({
            ...rideStats,
            ...driverStats
          });
        }
      );
    }
  );
});

app.listen(PORT, () => {
  console.log("Harvey Taxi running on port " + PORT);
});
