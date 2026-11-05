const mongoose = require("mongoose");
const logger = require("../utils/logger");

let connecting = null;

const connectDB = () => {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose.connection);
  if (connecting) return connecting;

  if (!process.env.MONGO) {
    return Promise.reject(new Error("MONGO is not set"));
  }

  connecting = mongoose
    .connect(process.env.MONGO, { serverSelectionTimeoutMS: 10000 })
    .then(() => {
      logger.info("DB", "MongoDB connected");
      return mongoose.connection;
    })
    .catch((err) => {
      connecting = null;
      logger.error("DB", "MongoDB connection error", err.message);
      throw err;
    });
  return connecting;
};

module.exports = connectDB;
