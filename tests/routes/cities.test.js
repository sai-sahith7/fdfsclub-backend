const request = require("supertest");
const express = require("express");
const bodyParser = require("body-parser");
const { setupTestDB, clearTestDB, teardownTestDB } = require("../setup");

const City = require("../../models/City");
const Venue = require("../../models/Venue");

jest.mock("../../middleware/auth", () => (req, res, next) => {
  req.user = { email: "test@example.com" };
  next();
});

jest.mock("../../clients/districtClient", () => ({
  getAllCinemas: jest.fn(),
}));
const districtClient = require("../../clients/districtClient");

const cityRoutes = require("../../routes/cities");

let app;

beforeAll(async () => {
  await setupTestDB();
  app = express();
  app.use(bodyParser.json());
  app.use("/api/cities", cityRoutes);
});

afterEach(async () => { await clearTestDB(); jest.clearAllMocks(); });
afterAll(async () => await teardownTestDB());

describe("GET /api/cities", () => {
  test("returns only active cities", async () => {
    await City.create({ _id: 1, name: "Active", slug: "active", is_active: true });
    await City.create({ _id: 2, name: "Inactive", slug: "inactive", is_active: false });
    const res = await request(app).get("/api/cities");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
  });

  test("returns empty array when no cities", async () => {
    const res = await request(app).get("/api/cities");
    expect(res.body.data).toEqual([]);
  });
});

describe("GET /api/cities/:cityId/venues", () => {
  test("returns venues for a city", async () => {
    await City.create({ _id: 1, name: "Test", slug: "test" });
    await City.create({ _id: 2, name: "Other", slug: "other" });
    await Venue.create({ _id: 100, name: "PVR", city_name: "Test", cinema_id: "c100" });
    await Venue.create({ _id: 200, name: "Other", city_name: "Other", cinema_id: "c200" });
    const res = await request(app).get("/api/cities/1/venues");
    expect(res.body.data.length).toBe(1);
  });

  test("returns venues for a city by slug", async () => {
    await City.create({ _id: 1, name: "Test", slug: "test" });
    await Venue.create({ _id: 100, name: "PVR", city_name: "Test", cinema_id: "c100" });
    await Venue.create({ _id: 200, name: "Other", city_name: "Other", cinema_id: "c200" });
    const res = await request(app).get("/api/cities/test/venues");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].name).toBe("PVR");
  });

  test("returns 404 for missing city", async () => {
    const res = await request(app).get("/api/cities/999/venues");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/cities/:cityId/venues/refresh", () => {
  test("syncs venues from District and stamps the city", async () => {
    await City.create({ _id: 1, name: "Pune", slug: "pune", latitude: 18.5, longitude: 73.8 });
    districtClient.getAllCinemas.mockResolvedValueOnce([
      { cinemaId: 900, providerId: 1, name: "New Cinema", address: "MG Road", latitude: 18.5, longitude: 73.8, amenities: [] },
    ]);

    const res = await request(app).post("/api/cities/pune/venues/refresh");

    expect(res.status).toBe(200);
    expect(res.body.data.refreshed).toBe(true);
    expect(await Venue.findById(900)).not.toBeNull();
    expect((await City.findById(1)).last_venue_sync_at).not.toBeNull();
    expect(res.body.data.more_coming).toBe(true);
    expect((await City.findById(1)).bms_sync_requested_at).toBeInstanceOf(Date);
  });

  test("does not hit District again within the cooldown", async () => {
    await City.create({ _id: 1, name: "Pune", slug: "pune", last_venue_sync_at: new Date() });

    const res = await request(app).post("/api/cities/pune/venues/refresh");

    expect(res.status).toBe(200);
    expect(res.body.data.refreshed).toBe(false);
    expect(districtClient.getAllCinemas).not.toHaveBeenCalled();
  });

  test("returns 404 for an unknown city", async () => {
    const res = await request(app).post("/api/cities/nowhere/venues/refresh");
    expect(res.status).toBe(404);
  });
});
