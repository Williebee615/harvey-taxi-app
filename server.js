const express = require("express");
const mongoose = require("mongoose");
y path = require("path");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log("MongoDB connected");
}).catch(err => {
  console.error("MongoDB error:", err);
});

// ✅ Schema
const driverSchema = new mongoose.Schema({
  fullName: String,
  phone: String,
  email: String,
  city: String,
  state: String,
  vehicleType: String,
  driverType: String,
  status: { type: String, default: "pending" },
  createdAt: { type: Date, default: Date.now }
});

const DriverApplication = mongoose.model("DriverApplication", driverSchema);

// ✅ Serve HTML files
app.use(express.static(__dirname));

// =============================
// 🚖 DRIVER SIGNUP ROUTE
// =============================
app.post("/api/driver/apply", async (req, res) => {
  try {
    const newDriver = new DriverApplication(req.body);
    await newDriver.save();

    res.json({ success: true, message: "Application submitted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// =============================
// 🧑‍💻 ADMIN PAGE
// =============================
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// =============================
// 📊 GET APPLICATIONS
// =============================
app.get("/api/driver/applications", async (req, res) => {
  try {
    const applications = await DriverApplication.find().sort({ createdAt: -1 });
    res.json({ success: true, applications });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// =============================
// ✅ APPROVE DRIVER
// =============================
app.post("/api/driver/applications/:id/approve", async (req, res) => {
  try {
    await DriverApplication.findByIdAndUpdate(req.params.id, {
      status: "approved"
    });
    res.json({ success: true, message: "Approved" });
  } catch {
    res.status(500).json({ success: false });
  }
});

// =============================
// ❌ REJECT DRIVER
// =============================
app.post("/api/driver/applications/:id/reject", async (req, res) => {
  try {
    await DriverApplication.findByIdAndUpdate(req.params.id, {
      status: "rejected"
    });
    res.json({ success: true, message: "Rejected" });
  } catch {
    res.status(500).json({ success: false });
  }
});

// =============================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Server running"));
