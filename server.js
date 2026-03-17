const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

// TEST ROUTE
app.get("/", (req, res) => {
  res.send("Harvey Taxi API is running ✅");
});

// DRIVER APPLICATION ROUTE (NO DATABASE YET)
let applications = [];

app.get("/api/driver-applications", (req, res) => {
  res.json(applications);
});

app.post("/api/driver-applications", (req, res) => {
  const newApp = {
    id: Date.now().toString(),
    fullName: req.body.fullName || "",
    email: req.body.email || "",
    phone: req.body.phone || "",
    vehicleType: req.body.vehicleType || "",
    licenseNumber: req.body.licenseNumber || "",
    status: "pending"
  };

  applications.push(newApp);
  res.json(newApp);
});

app.post("/api/driver-applications/:id/approve", (req, res) => {
  const appItem = applications.find(a => a.id === req.params.id);
  if (appItem) appItem.status = "approved";
  res.json(appItem);
});

app.post("/api/driver-applications/:id/reject", (req, res) => {
  const appItem = applications.find(a => a.id === req.params.id);
  if (appItem) appItem.status = "rejected";
  res.json(appItem);
});

// PORT
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
