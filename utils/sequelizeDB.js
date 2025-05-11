const sequelize = require('../config/database');
const models = require('../models');

sequelize.sync({ alter: true })
.then(() => {
  console.log('Database synced successfully');
})
.catch(error => {
  console.error('Error syncing database:', error);
});