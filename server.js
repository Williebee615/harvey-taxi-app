fconst express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function write(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/* HOME UI */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* FALLBACK FOR ALL PAGES */
app.get("/:page", (req, res) => {
  const file = path.join(__dirname, "public", req.params.page);

  if (fs.existsSync(file)) {
    res.sendFile(file);
  } else {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }
});

/* STATUS */
app.get("/api/status", (req, res) => {
  res.json({ status: "Harvey Taxi Running" });
});

/* RIDER SIGNUP */
app.post("/api/rider-signup", (req, res) => {
  const riders = read("riders.json");

  const rider = {
    id: Date.now(),
    name: req.body.name || "",
    phone: req.body.phone || "",
    email: req.body.email || "",
    created: new Date(),
  };

  riders.push(rider);
  write("riders.json", riders);

  res.json({ success: true });
});

/* DRIVER SIGNUP */
app.post("/api/driver-signup", (req, res) => {
  const drivers = read("drivers.json");

  const driver = {
    id: Date.now(),
    name: req.body.name || "",
    phone: req.body.phone || "",
    vehicle: req.body.vehicle || "",
    online: true,
    created: new Date(),
  };

  drivers.push(driver);
  write("drivers.json", drivers);

  res.json({ success: true });
});

/* REQUEST RIDE */
app.post("/api/request-ride", (req, res) => {
  const rides = read("rides.json");

  const ride = {
    id: Date.now(),
    pickup: req.body.pickup || "",
    dropoff: req.body.dropoff || "",
    status: "waiting",
    created: new Date(),
  };

  rides.push(ride);
  write("rides.json", rides);

  res.json({ success: true });
});

/* GET RIDES */
app.get("/api/rides", (req, res) => {
  res.json(read("rides.json"));
});

/* START SERVER */
app.listen(PORT, () => {
  console.log("Harvey Taxi UI Server Running on " + PORT);
});
/* ADMIN LOGIN */
app.post('/api/admin-login', (req, res) => {
  try {
    const { email, password } = req.body

    if (
      email === 'admin@harveytaxi.com' &&
      password === 'harvey123'
    ) {
      return res.json({
        success: true,
        user: {
          email: 'admin@harveytaxi.com',
          role: 'admin'
        }
      })
    }

    res.status(401).json({
      success: false,
      message: 'Invalid login'
    })

  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    })
  }
})
