const { default: axios } = require('axios');

const addressAPI = async (Address, City, State) => {
  try {
    const result = await axios.post(
      'http://85.192.56.243:5001/v1/address',
      [{ Address, City, State }],
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    return result.data;
  } catch (error) {
    console.error('Address API error:', error.message);
    throw error;
  }
};

module.exports = { addressAPI };