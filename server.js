const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// Serve all static files from the project folder
app.use(express.static(__dirname));

// Homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Route pages
app.get("/driver.html", (req, res) => {
  res.sendFile(path.join(__dirname, "driver.html"));
});

app.get("/driver-signup.html", (req, res) => {
  res.sendFile(path.join(__dirname, "driver-signup.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/request-ride.html", (req, res) => {
  res.sendFile(path.join(__dirname, "request-ride.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
