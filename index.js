require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const app = express();
const uploadRoute = require("./routes/uploadRoute");
const fs = require("fs");
const cors = require("cors");

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// Create upload folder if it doesn't exist
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}
// Create outputs folder if it doesn't exist
if (!fs.existsSync("outputs")) {
  fs.mkdirSync("outputs");
}

app.use(express.json());
app.use("/api", uploadRoute);

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected ✅'))
  .catch(err => console.error('MongoDB error:', err));

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
