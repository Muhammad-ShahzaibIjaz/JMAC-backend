const originalEmit = process.emit;
process.emit = function (event, warning) {
    if (event === 'warning' && warning?.code === 'DEP0169') {
        return false;
    }
    return originalEmit.apply(this, arguments);
};

const path = require("path");
require("dotenv").config();
const app = require("./app");
require("./utils/sequelizeDB");
const { initAddressHelper } = require('./utils/addressHelper');


const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    console.log('Initializing address helper...');
    await initAddressHelper();
    console.log('Address helper ready.');
 
    app.listen(PORT, () => {
      console.log(`Server Running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
