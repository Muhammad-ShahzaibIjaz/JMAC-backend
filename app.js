const express = require("express");
const cors = require("cors");
const app = express();


const corsOptions = {
  origin: ['http://localhost:3000', 'https://mac-insight.vercel.app', 'https://j-mac.vercel.app', 'https://mac-insight-dev.vercel.app', 'https://macinsight-dev.vercel.app'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
};

app.use(cors(corsOptions));

app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.json({ limit: '100mb' }));
app.set("timeout", 600000);


const excelRoutes = require("./routes/excelRoutes");
const templateRoutes = require("./routes/templateRoutes");
const headerRoutes = require("./routes/headerRoutes");
const fileRoutes = require("./routes/fileRoutes");
const dataRoutes = require("./routes/dataRoutes");
const mapheaderRoutes = require("./routes/mapheaderRoutes");
const maptemplateRoutes = require("./routes/maptemplateRoutes");
const ruleRoutes = require("./routes/ruleRoutes");
const revertRoutes = require("./routes/revertRoutes");
const visualDataRoutes = require("./routes/populationRoutes");
const referencesRoutes = require("./routes/crossReferenceRoutes");
const sheetRoutes = require("./routes/sheetRoute");
const pellRoutes = require("./routes/pellRoutes");
const populationStatusRoutes = require("./routes/PopulationStatusRoutes");
const treeRoutes = require("./routes/treeRoutes");




app.use("/api", excelRoutes);
app.use("/api", templateRoutes);
app.use("/api", headerRoutes);
app.use("/api", fileRoutes);
app.use("/api", dataRoutes);
app.use("/api", mapheaderRoutes);
app.use("/api", maptemplateRoutes);
app.use("/api", ruleRoutes);
app.use("/api", revertRoutes);
app.use("/api", visualDataRoutes);
app.use("/api", referencesRoutes);
app.use("/api", sheetRoutes);
app.use("/api", pellRoutes);
app.use("/api", populationStatusRoutes);
app.use("/api", treeRoutes);

module.exports = app;