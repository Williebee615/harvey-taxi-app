const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// Serve all static files
app.use(express.static(__dirname));app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/driver", (req, res) => {
  res.sendFile(path.join(__dirname, "driver.html"));
});

app.get("/request-ride", (req, res) => {
  res.sendFile(path.join(__dirname, "request-ride.html"));
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
