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
const ruleRoutes = require("./routes/ruleRoutes");
const revertRoutes = require("./routes/revertRoutes");
const visualDataRoutes = require("./routes/visualDataRoutes");
const referencesRoutes = require("./routes/crossReferenceRoutes");

app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.json({ limit: '100mb' }));
app.use(cors());
app.set("timeout", 600000);


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


module.exports = app;