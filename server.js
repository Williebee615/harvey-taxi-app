const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(__dirname));let drivers = [];
let applications = [];

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// TEST ROUTE
app.get("/test", (req, res) => {
  res.send("Server is working");
});

// DRIVER APPLY
app.post("/apply-driver", (req, res) => {
  const driver = {
    id: Date.now().toString(),
    ...req.body
  };

  drivers.push(driver);
  applications.push(driver);

  res.json({ success: true });
});

// GET DRIVERS
app.get("/drivers", (req, res) => {
  res.json(drivers);
});

// GET APPLICATIONS
app.get("/applications", (req, res) => {
  res.json(applications);
});

// FALLBACK
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
