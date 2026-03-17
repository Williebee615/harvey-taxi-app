let rideRequests = [];

// CREATE RIDE REQUEST
app.post("/request-ride", express.json(), (req, res) => {
  const { lat, lng } = req.body;

  if (!lat || !lng) {
    return res.status(400).json({ error: "Missing location" });
  }

  const newRide = {
    id: Date.now(),
    lat,
    lng,
    status: "waiting"
  };

  rideRequests.push(newRide);

  res.json({ success: true, ride: newRide });
});

// GET ALL RIDES
app.get("/rides", (req, res) => {
  res.json(rideRequests);
});<script>
async function requestRide(lat, lng) {
  try {
    const res = await fetch("/request-ride", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ lat, lng })
    });

    const data = await res.json();

    if (data.success) {
      document.body.innerHTML += "<p>✅ Ride requested!</p>";
    } else {
      document.body.innerHTML += "<p>❌ Failed</p>";
    }

  } catch (err) {
    document.body.innerHTML += "<p>❌ Error requesting ride</p>";
  }
}
</script>
