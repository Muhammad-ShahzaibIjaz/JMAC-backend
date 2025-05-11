const express = require("express");
const app = express();
const cors = require("cors");
const excelRoutes = require("./routes/excelRoutes");
const templateRoutes = require("./routes/templateRoutes");
const headerRoutes = require("./routes/headerRoutes");
const fileRoutes = require("./routes/fileRoutes");
const dataRoutes = require("./routes/dataRoutes");
const mapheaderRoutes = require("./routes/mapheaderRoutes");
const maptemplateRoutes = require("./routes/maptemplateRoutes");

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://j-mac.vercel.app');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});


app.use(
    cors({
      origin: "https://j-mac.vercel.app", // Allow only your frontend domain
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // Allow these HTTP methods
      allowedHeaders: ["Content-Type", "Authorization"], // Allow these headers (valid header names only)
      credentials: true, // If your frontend sends cookies or credentials
    })
  );
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.json({ limit: '100mb' }));

app.set("timeout", 600000);


app.use("/api", excelRoutes);
app.use("/api", templateRoutes);
app.use("/api", headerRoutes);
app.use("/api", fileRoutes);
app.use("/api", dataRoutes);
app.use("/api", mapheaderRoutes);
app.use("/api", maptemplateRoutes);


module.exports = app;