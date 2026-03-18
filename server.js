const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(__dirname));

let drivers = [];
let applications = [];

let driverStats = {
  name: "WILLIE",
  photo: "https://via.placeholder.com/80",
  rating: 4.96,
  tier: "Starter",
  rides: 0,
  deliveries: 0,
  earnings: 0,
  acceptanceRate: 0,
  cancellationRate: 0,
  completionRate: 0
};

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/apply-driver", (req, res) => {
  const driver = {
    id: Date.now().toString(),
    name: req.body.name || "",
    email: req.body.email || "",
    phone: req.body.phone || "",
    city: req.body.city || "",
    state: req.body.state || "",
    vehicleType: req.body.vehicleType || "",
    driverType: req.body.driverType || "",
    status: "pending"
  };

  drivers.push(driver);
  applications.push(driver);

  res.json({ success: true, driver });
});

app.get("/drivers", (req, res) => {
  res.json(drivers);
});

app.get("/applications", (req, res) => {
  res.json(applications);
});

app.post("/approve/:id", (req, res) => {
  const item = applications.find(a => a.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });

  item.status = "approved";
  res.json({ success: true, item });
});

app.post("/reject/:id", (req, res) => {
  const item = applications.find(a => a.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });

  item.status = "rejected";
  res.json({ success: true, item });
});

app.get("/driver-stats", (req, res) => {
  res.json(driverStats);
});

app.post("/complete-ride", (req, res) => {
  driverStats.rides += 1;
  driverStats.earnings += 15;
  driverStats.acceptanceRate = 100;
  driverStats.completionRate = 100;
  if (driverStats.rides >= 10) driverStats.tier = "Blue";
  res.json({ success: true, stats: driverStats });
});

app.post("/complete-delivery", (req, res) => {
  driverStats.deliveries += 1;
  driverStats.earnings += 10;
  driverStats.acceptanceRate = 100;
  driverStats.completionRate = 100;
  if (driverStats.deliveries >= 10) driverStats.tier = "Blue";
  res.json({ success: true, stats: driverStats });
});

app.get("/test", (req, res) => {
  res.send("Server is working");
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
