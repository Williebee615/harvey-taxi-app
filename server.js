const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

// ✅ SERVE FRONTEND FILES
app.use(express.static(path.join(__dirname, "public")));

// TEST ROUTE
app.get("/api", (req, res) => {
  res.send("Harvey Taxi API is running");
});

// STORAGE
let applications = [];
let idCounter = 1;

// GET APPLICATIONS
app.get("/api/driver-applications", (req, res) => {
  res.json(applications);
});

// CREATE APPLICATION
app.post("/api/driver-applications", (req, res) => {
  const newApp = {
    id: idCounter++,
    name: req.body.name || "Unknown",
    status: "pending"
  };
  applications.push(newApp);
  res.json(newApp);
});

// APPROVE
app.post("/api/approve-driver/:id", (req, res) => {
  const appItem = applications.find(a => a.id == req.params.id);
  if (appItem) appItem.status = "approved";
  res.json({ success: true });
});

// REJECT
app.post("/api/reject-driver/:id", (req, res) => {
  const appItem = applications.find(a => a.id == req.params.id);
  if (appItem) appItem.status = "rejected";
  res.json({ success: true });
});

// START SERVER
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
