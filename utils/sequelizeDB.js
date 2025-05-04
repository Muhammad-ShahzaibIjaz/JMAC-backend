const sequelize = require('../config/database');

sequelize.sync({ alter: true })
.then(() => {
  console.log('Database synced successfully');
})
.catch(error => {
  console.error('Error syncing database:', error);
});