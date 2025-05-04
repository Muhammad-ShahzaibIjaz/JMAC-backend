const express = require("express");
const app = express();
const cors = require("cors");
const excelRoutes = require("./routes/excelRoutes");



app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

app.use("/api", excelRoutes);


module.exports = app;