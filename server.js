const express = require("express");
const app = express();
const PORT = process.env.PORT || 10000;

// Serve all files (this is what was working before)
app.use(express.static(__dirname));

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
