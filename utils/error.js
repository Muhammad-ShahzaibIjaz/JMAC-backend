class CustomError extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
      this.name = "CustomError";
    }
  }
  
  module.exports = { CustomError };