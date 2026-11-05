const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoServer;

async function setupTestDB() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}

async function clearTestDB() {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}

async function teardownTestDB() {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
}

function createTestApp() {
  const express = require("express");
  const bodyParser = require("body-parser");

  const app = express();
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));

  return app;
}

function fakeAuth(userOverrides = {}) {
  return (req, res, next) => {
    req.user = {
      email: "test@example.com",
      name: "Test User",
      ...userOverrides,
    };
    next();
  };
}

module.exports = {
  setupTestDB,
  clearTestDB,
  teardownTestDB,
  createTestApp,
  fakeAuth,
};
