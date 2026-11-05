const request = require("supertest");
const express = require("express");
const bodyParser = require("body-parser");
const { setupTestDB, clearTestDB, teardownTestDB } = require("../setup");
const User = require("../../models/User");
const City = require("../../models/City");
const TelegramConnection = require("../../models/TelegramConnection");

jest.mock("../../middleware/auth", () => {
  return (req, res, next) => {
    req.user = { email: "test@example.com", name: "Test User" };
    next();
  };
});

jest.mock("../../clients/districtClient", () => ({
  resolveLocation: jest.fn(),
  getGroupedMovies: jest.fn().mockResolvedValue([]),
  getAllCinemas: jest.fn().mockResolvedValue([]),
}));
const districtClient = require("../../clients/districtClient");

jest.mock("../../clients/telegramBot", () => ({
  sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
}));
const telegramBot = require("../../clients/telegramBot");

const userRoutes = require("../../routes/users");

let app;

beforeAll(async () => {
  await setupTestDB();
  app = express();
  app.use(bodyParser.json());
  app.use("/api/user", userRoutes);
});
afterEach(async () => { await clearTestDB(); jest.clearAllMocks(); });
afterAll(async () => await teardownTestDB());

describe("GET /api/user/me", () => {
  test("returns user profile", async () => {
    await User.create({ email: "test@example.com", name: "Test User" });
    const res = await request(app).get("/api/user/me");
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("test@example.com");
  });

  test("returns 404 if user doesn't exist", async () => {
    const res = await request(app).get("/api/user/me");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/user/me", () => {
  test("updates allowed fields", async () => {
    await User.create({ email: "test@example.com", name: "Old Name" });
    const res = await request(app).patch("/api/user/me").send({ name: "New Name" });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("New Name");
  });

  test("ignores disallowed fields", async () => {
    await User.create({ email: "test@example.com", name: "Test" });
    const res = await request(app).patch("/api/user/me").send({ email: "hacked@evil.com" });
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("test@example.com");
  });

  test("cannot link Telegram by patching the profile directly", async () => {
    await User.create({ email: "test@example.com", name: "Test" });
    const res = await request(app)
      .patch("/api/user/me")
      .send({ telegram: { chat_id: "999", connected: true }, default_city: { name: "X", slug: "x" } });
    expect(res.status).toBe(200);
    expect(res.body.data.telegram.connected).toBe(false);
    expect(res.body.data.telegram.chat_id).toBeNull();
    expect(res.body.data.default_city.slug).toBeNull();
  });

  test("rejects an empty name", async () => {
    await User.create({ email: "test@example.com", name: "Test" });
    const res = await request(app).patch("/api/user/me").send({ name: "   " });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/user/me: favourite city", () => {
  beforeEach(async () => {
    await User.create({ email: "test@example.com", name: "Test" });
    await City.create([
      { _id: 1, name: "Bengaluru", slug: "bengaluru" },
      { _id: 2, name: "Hyderabad", slug: "hyderabad" },
    ]);
  });

  test("sets the favourite city from a slug", async () => {
    const res = await request(app).patch("/api/user/me").send({ favourite_city: "hyderabad" });

    expect(res.status).toBe(200);
    expect(res.body.data.favourite_city).toEqual({ name: "Hyderabad", slug: "hyderabad" });

    const user = await User.findOne({ email: "test@example.com" });
    expect(user.favourite_city.slug).toBe("hyderabad");
    expect(user.favourite_city.name).toBe("Hyderabad");
  });

  test("resolves the canonical name when given an object", async () => {
    const res = await request(app)
      .patch("/api/user/me")
      .send({ favourite_city: { slug: "bengaluru", name: "whatever the client thinks" } });

    expect(res.status).toBe(200);
    expect(res.body.data.favourite_city).toEqual({ name: "Bengaluru", slug: "bengaluru" });
  });

  test("accepts a city name when no slug is given", async () => {
    const res = await request(app)
      .patch("/api/user/me")
      .send({ favourite_city: { name: "Bengaluru" } });

    expect(res.status).toBe(200);
    expect(res.body.data.favourite_city.slug).toBe("bengaluru");
  });

  test("clears the favourite city with null", async () => {
    await request(app).patch("/api/user/me").send({ favourite_city: "hyderabad" });

    const res = await request(app).patch("/api/user/me").send({ favourite_city: null });
    expect(res.status).toBe(200);
    expect(res.body.data.favourite_city).toEqual({ name: null, slug: null });
  });

  test("rejects an unknown city with 404", async () => {
    const res = await request(app).patch("/api/user/me").send({ favourite_city: "atlantis" });
    expect(res.status).toBe(404);

    const user = await User.findOne({ email: "test@example.com" });
    expect(user.favourite_city.slug).toBeNull();
  });

  test("rejects an empty favourite city object with 400", async () => {
    const res = await request(app).patch("/api/user/me").send({ favourite_city: {} });
    expect(res.status).toBe(400);
  });

  test("leaves the favourite city untouched when not supplied", async () => {
    await request(app).patch("/api/user/me").send({ favourite_city: "hyderabad" });

    const res = await request(app).patch("/api/user/me").send({ name: "Renamed" });
    expect(res.body.data.name).toBe("Renamed");
    expect(res.body.data.favourite_city.slug).toBe("hyderabad");
  });
});

describe("GET /api/user/me: favourite city", () => {
  test("defaults to an empty favourite city for existing users", async () => {
    await User.create({ email: "test@example.com", name: "Test User" });
    const res = await request(app).get("/api/user/me");
    expect(res.body.data.favourite_city).toEqual({ name: null, slug: null });
  });
});

describe("POST /api/user/location", () => {
  test("resolves location and sets default city", async () => {
    await User.create({ email: "test@example.com", name: "Test" });
    await City.create({ _id: 4, name: "Bengaluru", slug: "bengaluru" });

    districtClient.resolveLocation.mockResolvedValue({
      cityId: 4, cityName: "Bengaluru", cityKey: "bengaluru",
      stateKey: "karnataka", lat: 12.97, lng: 77.59,
    });

    const res = await request(app).post("/api/user/location").send({ lat: 12.97, lng: 77.59 });
    expect(res.status).toBe(200);
    expect(res.body.data.city.id).toBe(4);
    expect(res.body.data.city.name).toBe("Bengaluru");
    expect(res.body.data.catalog_loading).toBe(false);
  });

  test("creates new city when not in DB", async () => {
    await User.create({ email: "test@example.com", name: "Test" });

    districtClient.resolveLocation.mockResolvedValue({
      cityId: 99, cityName: "New City", cityKey: "new-city",
      stateKey: "state", lat: 10, lng: 75,
    });

    const res = await request(app).post("/api/user/location").send({ lat: 10, lng: 75 });
    expect(res.status).toBe(200);
    expect(res.body.data.city_added).toBe(true);
    expect(res.body.data.catalog_loading).toBe(true);

    const city = await City.findById(99);
    expect(city).not.toBeNull();
    expect(city.name).toBe("New City");
    expect(city.movie_sync_requested_at).toBeInstanceOf(Date);
    expect(city.venue_sync_requested_at).toBeInstanceOf(Date);
    expect(city.bms_sync_requested_at).toBeInstanceOf(Date);
    expect(districtClient.getGroupedMovies).not.toHaveBeenCalled();
  });

  test("requires lat and lng", async () => {
    const res = await request(app).post("/api/user/location").send({});
    expect(res.status).toBe(400);
  });

  test("handles District API failure", async () => {
    await User.create({ email: "test@example.com", name: "Test" });
    districtClient.resolveLocation.mockRejectedValue(new Error("API down"));

    const res = await request(app).post("/api/user/location").send({ lat: 12, lng: 77 });
    expect(res.status).toBe(502);
  });
});

describe("POST /api/user/telegram/verify", () => {
  test("links telegram to user successfully", async () => {
    await User.create({ email: "test@example.com", name: "Test" });
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);
    
    await TelegramConnection.create({
      code: "123456",
      telegram_handle: "myhandle",
      chat_id: "123456789",
      expires_at: expiresAt,
      status: "PENDING"
    });

    const res = await request(app)
      .post("/api/user/telegram/verify")
      .send({ code: "123456" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
    expect(res.body.data.telegram.connected).toBe(true);
    expect(res.body.data.telegram.chat_id).toBe("123456789");
    expect(res.body.data.telegram.username).toBe("myhandle");

    const conn = await TelegramConnection.findOne({ code: "123456" });
    expect(conn.status).toBe("COMPLETED");

    const user = await User.findOne({ email: "test@example.com" });
    expect(user.telegram.connected).toBe(true);
    expect(user.telegram.chat_id).toBe("123456789");
    expect(user.telegram.username).toBe("myhandle");
  });

  test("confirms the link inside Telegram", async () => {
    await User.create({ email: "test@example.com", name: "Test" });
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    await TelegramConnection.create({
      code: "123456",
      telegram_handle: "myhandle",
      chat_id: "123456789",
      expires_at: expiresAt,
      status: "PENDING",
    });

    await request(app).post("/api/user/telegram/verify").send({ code: "123456" });

    expect(telegramBot.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text] = telegramBot.sendMessage.mock.calls[0];
    expect(chatId).toBe("123456789");
    expect(text).toContain("connected");
    expect(text).toContain("test@example.com");
  });

  test("still connects when the Telegram confirmation fails to send", async () => {
    await User.create({ email: "test@example.com", name: "Test" });
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    await TelegramConnection.create({
      code: "123456",
      telegram_handle: "myhandle",
      chat_id: "123456789",
      expires_at: expiresAt,
      status: "PENDING",
    });

    telegramBot.sendMessage.mockRejectedValueOnce(new Error("chat not found"));

    const res = await request(app).post("/api/user/telegram/verify").send({ code: "123456" });

    expect(res.status).toBe(200);
    const user = await User.findOne({ email: "test@example.com" });
    expect(user.telegram.connected).toBe(true);
  });

  test("does not message Telegram when the code is invalid", async () => {
    await request(app).post("/api/user/telegram/verify").send({ code: "999999" });
    expect(telegramBot.sendMessage).not.toHaveBeenCalled();
  });

  test("requires code", async () => {
    const res = await request(app)
      .post("/api/user/telegram/verify")
      .send({});
    expect(res.status).toBe(400);
  });

  test("rejects query operators in place of a code", async () => {
    await User.create({ email: "test@example.com", name: "Test" });
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await TelegramConnection.create({
      code: "222222",
      telegram_handle: "victim",
      chat_id: "555",
      expires_at: expiresAt,
      status: "PENDING",
    });

    const res = await request(app)
      .post("/api/user/telegram/verify")
      .send({ code: { $ne: "x" } });

    expect(res.status).toBe(400);
    const user = await User.findOne({ email: "test@example.com" });
    expect(user.telegram.connected).toBe(false);
  });

  test("returns 400 for incorrect code", async () => {
    const res = await request(app)
      .post("/api/user/telegram/verify")
      .send({ code: "999999" });
    expect(res.status).toBe(400);
  });

  test("returns 400 for expired code", async () => {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() - 5);
    
    await TelegramConnection.create({
      code: "654321",
      telegram_handle: "myhandle",
      chat_id: "123456789",
      expires_at: expiresAt,
      status: "PENDING"
    });

    const res = await request(app)
      .post("/api/user/telegram/verify")
      .send({ code: "654321" });

    expect(res.status).toBe(400);
  });
});
