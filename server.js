const path = require("path");
require("dotenv").config();
const app = require("./app");
require("./utils/sequelizeDB");


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server Running on port ${PORT}`);
});
