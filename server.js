const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(".")); // serve HTML files

// ===== DATABASE (TEMP MEMORY) =====
let applications = [];

// ===== DRIVER SIGNUP =====
app.post("/api/driver/signup", (req, res) => {
  const driver = {
    id: Date.now().toString(),
    name: req.body.name,
    email: req.body.email,
    phone: req.body.phone,
    city: req.body.city,
    state: req.body.state,
    vehicleType: req.body.vehicleType,
    driverType: req.body.driverType,
    status: "pending",
    createdAt: new Date()
  };

  applications.push(driver);

  res.json({ success: true, driver });
});

// ===== GET ALL APPLICATIONS (ADMIN) =====
app.get("/api/admin/applications", (req, res) => {
  res.json(applications);
});// ===== APPROVE DRIVER =====
app.post("/api/admin/approve/:id", (req, res) => {
  const id = req.params.id;

  const driver = applications.find(d => d.id === id);

  if (!driver) {
    return res.status(404).json({ error: "Driver not found" });
  }

  driver.status = "approved";

  res.json({ success: true, driver });
});

// ===== REJECT DRIVER =====
app.post("/api/admin/reject/:id", (req, res) => {
  const id = req.params.id;

  const driver = applications.find(d => d.id === id);

  if (!driver) {
    return res.status(404).json({ error: "Driver not found" });
  }

  driver.status = "rejected";

  res.json({ success: true, driver });
});

// ===== HEALTH CHECK =====
app.get("/", (req, res) => {
  res.send("Harvey Taxi API Running");
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
