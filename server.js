const express = require("express");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const db = new sqlite3.Database("taxi.db");

let driverLocations = [];
let driverNotifications = [];

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
      paymentMethod TEXT DEFAULT 'cash',
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
  db.run(`ALTER TABLE rides ADD COLUMN paymentMethod TEXT DEFAULT 'cash'`, () => {});
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

function toRad(value) {
  return (value * Math.PI) / 180;
}

function distanceMiles(lat1, lon1, lat2, lon2) {
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

function parseLatLng(text) {
  if (!text || typeof text !== "string") return null;
  const parts = text.split(",");
  if (parts.length < 2) return null;

  const lat = Number(parts[0].trim());
  const lng = Number(parts[1].trim());

  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}

function estimateEtaMinutes(miles) {
  const avgCitySpeedMph = 20;
  return Math.max(2, Math.round((miles / avgCitySpeedMph) * 60));
}

function findClosestApprovedDriver(pickupText, approvedDrivers) {
  const pickupCoords = parseLatLng(pickupText);
  if (!pickupCoords) return null;

  const onlineApprovedDrivers = approvedDrivers
    .map((driver) => {
      const loc = driverLocations.find((d) => d.name === driver.name);
      if (!loc) return null;

      const miles = distanceMiles(
        pickupCoords.lat,
        pickupCoords.lng,
        loc.lat,
        loc.lng
      );

      return {
        name: driver.name,
        lat: loc.lat,
        lng: loc.lng,
        distanceMiles: Number(miles.toFixed(2)),
        etaMinutes: estimateEtaMinutes(miles)
      };
    })
    .filter(Boolean);

  if (!onlineApprovedDrivers.length) return null;

  onlineApprovedDrivers.sort((a, b) => a.distanceMiles - b.distanceMiles);
  return onlineApprovedDrivers[0];
}

function addDriverNotification(driverName, message, rideId) {
  driverNotifications.push({
    id: Date.now() + Math.random(),
    driverName,
    message,
    rideId,
    createdAt: Date.now()
  });

  driverNotifications = driverNotifications.slice(-100);
}

/* RIDES */

app.post("/request-ride", (req, res) => {
  const { name, phone, pickup, dropoff, paymentMethod } = req.body;

  if (!name || !phone || !pickup || !dropoff) {
    return res.status(400).json({ success: false, error: "Missing ride fields" });
  }

  const fare = estimateFare(pickup, dropoff);
  const safePaymentMethod = paymentMethod || "cash";

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
        `INSERT INTO rides (name, phone, pickup, dropoff, status, acceptedBy, fare, paymentMethod)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, phone, pickup, dropoff, assignedStatus, assignedDriver, fare, safePaymentMethod],
        function (err) {
          if (err) return res.status(500).json({ success: false, error: err.message });

          if (closestDriver) {
            addDriverNotification(
              closestDriver.name,
              `New auto-assigned ride for ${name}`,
              this.lastID
            );
          }

          res.json({
            success: true,
            rideId: this.lastID,
            fare,
            autoAssigned: !!closestDriver,
            assignedDriver: assignedDriver || null,
            etaMinutes: closestDriver ? closestDriver.etaMinutes : null,
            paymentReady: false,
            paymentNote: "Card processing requires Stripe keys later. Cash and manual payments work now."
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

app.get("/ride-status/:id", (req, res) => {
  const rideId = req.params.id;

  db.get("SELECT * FROM rides WHERE id = ?", [rideId], (err, ride) => {
    if (err || !ride) {
      return res.status(404).json({ success: false, error: "Ride not found" });
    }

    let etaMinutes = null;
    let driverLat = null;
    let driverLng = null;

    if (ride.acceptedBy) {
      const driverLoc = driverLocations.find((d) => d.name === ride.acceptedBy);
      const pickupCoords = parseLatLng(ride.pickup);

      if (driverLoc) {
        driverLat = driverLoc.lat;
        driverLng = driverLoc.lng;
      }

      if (driverLoc && pickupCoords) {
        const miles = distanceMiles(
          driverLoc.lat,
          driverLoc.lng,
          pickupCoords.lat,
          pickupCoords.lng
        );
        etaMinutes = estimateEtaMinutes(miles);
      }
    }

    res.json({
      success: true,
      ride,
      etaMinutes,
      driverLat,
      driverLng
    });
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
     WHERE id = ? AND (status = 'waiting' OR acceptedBy = ?)`,
    [driverName, rideId, driverName],
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
              addDriverNotification(
                ride.acceptedBy,
                `Ride #${ride.id} completed. Earnings added.`,
                ride.id
              );
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
    if (err) return res.status(500).json({ success: false, error: err.message });app.listen(PORT, () => {
  console.log("Harvey Taxi running on port " + PORT);
});
    res.json(rows);
  });
});

app.post("/approve-driver/:id", (req, res
