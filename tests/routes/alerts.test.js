const request = require("supertest");
const express = require("express");
const bodyParser = require("body-parser");
const { setupTestDB, clearTestDB, teardownTestDB } = require("../setup");

const Alert = require("../../models/Alert");
const AlertNotification = require("../../models/AlertNotification");
const City = require("../../models/City");
const Movie = require("../../models/Movie");
const Venue = require("../../models/Venue");

jest.mock("../../middleware/auth", () => {
  return (req, res, next) => {
    req.user = { email: "test@example.com", name: "Test User" };
    next();
  };
});

const alertRoutes = require("../../routes/alerts");

let app;

beforeAll(async () => {
  await setupTestDB();
  app = express();
  app.use(bodyParser.json());
  app.use("/api/alerts", alertRoutes);
});

afterEach(async () => await clearTestDB());
afterAll(async () => await teardownTestDB());

const VALID_ALERT_BODY = {
  movie: { id: 100, name: "Test Movie", image_url: "https://example.com/poster.jpg" },
  city: { name: "Bengaluru" },
  alert_date: new Date(Date.now() + 86400000).toISOString(),
};

describe("GET /api/alerts", () => {
  test("returns empty array when no alerts exist", async () => {
    const res = await request(app).get("/api/alerts");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  test("returns only the authenticated user's alerts", async () => {
    await Alert.create({
      user_email: "test@example.com", movie: { id: 100, name: "Mine" },
      city: { name: "Test" }, alert_date: new Date(),
    });
    await Alert.create({
      user_email: "other@example.com", movie: { id: 200, name: "Theirs" },
      city: { name: "Test" }, alert_date: new Date(),
    });

    const res = await request(app).get("/api/alerts");
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].movie.name).toBe("Mine");
  });

  test("filters by status query param", async () => {
    await Alert.create({
      user_email: "test@example.com", movie: { id: 100, name: "Active" },
      city: { name: "Test" }, alert_date: new Date(), status: "ACTIVE",
    });
    await Alert.create({
      user_email: "test@example.com", movie: { id: 200, name: "Alerted" },
      city: { name: "Test" }, alert_date: new Date(), status: "ALERTED",
    });

    const res = await request(app).get("/api/alerts?status=ACTIVE");
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].movie.name).toBe("Active");
  });

  test("paginates history across several statuses", async () => {
    for (const status of ["ACTIVE", "ALERTED", "CANCELLED", "EXPIRED"]) {
      await Alert.create({
        user_email: "test@example.com", movie: { id: 1, name: status },
        city: { name: "Test" }, alert_date: new Date(), status,
      });
    }

    const res = await request(app).get("/api/alerts?status=ALERTED,CANCELLED,EXPIRED");
    expect(res.status).toBe(200);
    expect(res.body.data.alerts.map((alert) => alert.status).sort()).toEqual(["ALERTED", "CANCELLED", "EXPIRED"]);
    expect(res.body.data.pagination.total).toBe(3);
  });

  test("rejects unknown or operator statuses", async () => {
    expect((await request(app).get("/api/alerts?status=BOGUS")).status).toBe(400);
    expect((await request(app).get("/api/alerts?status[$ne]=ACTIVE")).status).toBe(400);
  });

  test("returns alerts sorted by created_at desc", async () => {
    await Alert.create({
      user_email: "test@example.com", movie: { id: 100, name: "First" },
      city: { name: "Test" }, alert_date: new Date(),
    });
    await new Promise(r => setTimeout(r, 50));
    await Alert.create({
      user_email: "test@example.com", movie: { id: 200, name: "Second" },
      city: { name: "Test" }, alert_date: new Date(),
    });

    const res = await request(app).get("/api/alerts");
    expect(res.body.data[0].movie.name).toBe("Second");
  });
});

describe("GET /api/alerts/:alertId", () => {
  test("returns alert with notification history", async () => {
    const alert = await Alert.create({
      user_email: "test@example.com", movie: { id: 100, name: "Test" },
      city: { name: "Test" }, alert_date: new Date(), status: "ALERTED",
    });
    await AlertNotification.create({
      alert_id: alert._id, channel: "email", status: "sent",
      payload: { movie: "Test" },
    });

    const res = await request(app).get(`/api/alerts/${alert._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.alert._id).toBe(alert._id);
    expect(res.body.data.notifications.length).toBe(1);
    expect(res.body.data.notifications[0].channel).toBe("email");
  });

  test("returns 404 for non-existent alert", async () => {
    const res = await request(app).get("/api/alerts/nonexistent-id");
    expect(res.status).toBe(404);
  });

  test("returns 404 for another user's alert", async () => {
    const alert = await Alert.create({
      user_email: "other@example.com", movie: { id: 100, name: "Test" },
      city: { name: "Test" }, alert_date: new Date(),
    });

    const res = await request(app).get(`/api/alerts/${alert._id}`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/alerts", () => {
  const istDate = (offsetDays) =>
    new Date(Date.now() + offsetDays * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  beforeEach(async () => {
    await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });
    await Movie.create({ contentId: 100, name: "Test Movie", image_url: "https://img.example/catalogue.jpg" });
    await Venue.create({ _id: 500, name: "PVR Cinemas", city_name: "Bengaluru", cinema_id: "500" });
    await Venue.create({ _id: 600, name: "Cinepolis", city_name: "Bengaluru", cinema_id: "600" });
  });

  test("creates an alert with valid data", async () => {
    const res = await request(app)
      .post("/api/alerts")
      .send(VALID_ALERT_BODY);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe(true);
    expect(res.body.data.status).toBe("ACTIVE");
    expect(res.body.data.movie.name).toBe("Test Movie");
    expect(res.body.data.user_email).toBe("test@example.com");
    expect(res.body.data.last_scan_group_key).toMatch(/^100:Bengaluru:/);
  });

  test("takes the movie's name and poster from the catalogue, not the request", async () => {
    const res = await request(app).post("/api/alerts").send({
      ...VALID_ALERT_BODY,
      movie: { id: 100, name: "<script>", image_url: "javascript:alert(1)" },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.movie).toEqual({ id: 100, name: "Test Movie", image_url: "https://img.example/catalogue.jpg" });
  });

  test("rejects a movie that isn't in the catalogue", async () => {
    const res = await request(app).post("/api/alerts").send({ ...VALID_ALERT_BODY, movie: { id: 999 } });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("MOVIE_NOT_FOUND");
  });

  test("requires a movie", async () => {
    const res = await request(app).post("/api/alerts").send({
      city: { name: "Bengaluru" }, alert_date: istDate(1),
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("movie");
  });

  test("requires a city", async () => {
    const res = await request(app).post("/api/alerts").send({
      movie: { id: 100 }, alert_date: istDate(1),
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("city");
  });

  test("requires a date", async () => {
    const res = await request(app).post("/api/alerts").send({
      movie: { id: 100 }, city: { name: "Bengaluru" },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("date");
  });

  test("rejects a date in the past", async () => {
    const res = await request(app).post("/api/alerts").send({
      ...VALID_ALERT_BODY,
      alert_date: "2020-01-01",
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("past");
  });

  test("accepts today in IST", async () => {
    const res = await request(app).post("/api/alerts").send({ ...VALID_ALERT_BODY, alert_date: istDate(0) });
    expect(res.status).toBe(201);
  });

  test("rejects a date beyond the bookable window", async () => {
    const res = await request(app).post("/api/alerts").send({ ...VALID_ALERT_BODY, alert_date: istDate(40) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("DATE_TOO_FAR");
  });

  test("allows the window to start at a later release date", async () => {
    await Movie.updateOne({ contentId: 100 }, { $set: { release_date: istDate(30) } });
    const res = await request(app).post("/api/alerts").send({ ...VALID_ALERT_BODY, alert_date: istDate(35) });
    expect(res.status).toBe(201);
  });

  test("expires at the end of the alert's day in IST", async () => {
    const date = istDate(2);
    const res = await request(app).post("/api/alerts").send({ ...VALID_ALERT_BODY, alert_date: date });
    expect(res.status).toBe(201);
    expect(new Date(res.body.data.expires_at).toISOString()).toBe(new Date(`${date}T23:59:59.999+05:30`).toISOString());
    expect(res.body.data.alert_date.slice(0, 10)).toBe(date);
  });

  test("stores optional venue data (legacy single venue format)", async () => {
    const res = await request(app).post("/api/alerts").send({
      ...VALID_ALERT_BODY,
      venue: { id: 500, name: "PVR Cinemas" },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.venues).toEqual([{ id: 500, name: "PVR Cinemas", source: "district" }]);
  });

  test("stores multiple venues with names from the catalogue", async () => {
    const res = await request(app).post("/api/alerts").send({
      ...VALID_ALERT_BODY,
      venues: [
        { id: 500, name: "anything the client says" },
        { id: 600 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.venues.map((venue) => venue.name)).toEqual(["PVR Cinemas", "Cinepolis"]);
  });

  test("rejects theatres that aren't in this city", async () => {
    await Venue.create({ _id: 700, name: "Elsewhere", city_name: "Mumbai", cinema_id: "700" });
    const res = await request(app).post("/api/alerts").send({ ...VALID_ALERT_BODY, venues: [{ id: 700 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("THEATRE_NOT_FOUND");
  });

  test("stores filter preferences", async () => {
    const res = await request(app).post("/api/alerts").send({
      ...VALID_ALERT_BODY,
      filters: { formats: ["IMAX"], languages: ["Hindi"], price_max: 500 },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.filters.formats).toEqual(["IMAX"]);
    expect(res.body.data.filters.price_max).toBe(500);
  });

  test("keeps a midnight show-time filter instead of dropping it", async () => {
    const res = await request(app).post("/api/alerts").send({
      ...VALID_ALERT_BODY,
      filters: { show_time_min: 0, show_time_max: 600, price_min: 0, price_max: 300 },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.filters.show_time_min).toBe(0);
    expect(res.body.data.filters.price_min).toBe(0);
  });

  test("rejects an inverted price range", async () => {
    const res = await request(app).post("/api/alerts").send({
      ...VALID_ALERT_BODY,
      filters: { price_min: 800, price_max: 200 },
    });
    expect(res.status).toBe(400);
  });

  test("rejects an unparseable date", async () => {
    const res = await request(app).post("/api/alerts").send({ ...VALID_ALERT_BODY, alert_date: "soon" });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("date");
  });

  test("refuses an exact duplicate with 409", async () => {
    const body = { ...VALID_ALERT_BODY, alert_date: istDate(1), venues: [{ id: 500 }], filters: { formats: ["IMAX"] } };
    expect((await request(app).post("/api/alerts").send(body)).status).toBe(201);
    const res = await request(app).post("/api/alerts").send(body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DUPLICATE_ALERT");
  });

  test("allows the same movie and date with different theatres or filters", async () => {
    const base = { ...VALID_ALERT_BODY, alert_date: istDate(1) };
    expect((await request(app).post("/api/alerts").send({ ...base, filters: { formats: ["IMAX"] } })).status).toBe(201);
    expect((await request(app).post("/api/alerts").send({ ...base, filters: { formats: ["2D"] } })).status).toBe(201);
    expect((await request(app).post("/api/alerts").send({ ...base, venues: [{ id: 600 }] })).status).toBe(201);
  });

  test("caps active alerts per account", async () => {
    const { MAX_ACTIVE_ALERTS_PER_USER } = require("../../constants/appConstants");
    await Alert.insertMany(Array.from({ length: MAX_ACTIVE_ALERTS_PER_USER }, (_, i) => ({
      _id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
      user_email: "test@example.com", movie: { id: 1000 + i, name: `M${i}` },
      city: { name: "Bengaluru" }, alert_date: new Date(), status: "ACTIVE",
    })));
    const res = await request(app).post("/api/alerts").send(VALID_ALERT_BODY);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALERT_LIMIT");
  });

  test("keeps the active alert cap when several alerts are created at once", async () => {
    const { MAX_ACTIVE_ALERTS_PER_USER } = require("../../constants/appConstants");
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((day) => request(app).post("/api/alerts").send({ ...VALID_ALERT_BODY, alert_date: istDate(day) }))
    );
    const active = await Alert.countDocuments({ user_email: "test@example.com", status: "ACTIVE" });
    expect(active).toBe(MAX_ACTIVE_ALERTS_PER_USER);
    expect(results.filter((res) => res.status === 201)).toHaveLength(MAX_ACTIVE_ALERTS_PER_USER);
    expect(results.every((res) => res.status === 201 || res.body.code === "ALERT_LIMIT")).toBe(true);
  });

  test("keeps exactly one of two identical alerts created at once", async () => {
    const results = await Promise.all([1, 2].map(() => request(app).post("/api/alerts").send({ ...VALID_ALERT_BODY, alert_date: istDate(1) })));
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(results.find((res) => res.status === 409).body.code).toBe("DUPLICATE_ALERT");
    expect(await Alert.countDocuments({ user_email: "test@example.com", status: "ACTIVE" })).toBe(1);
  });

  test("refuses a movie without a positive id", async () => {
    const res = await request(app).post("/api/alerts").send({ ...VALID_ALERT_BODY, movie: { id: 0 } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MOVIE_REQUIRED");
  });

  test("never leaks internal error details", async () => {
    const spy = jest.spyOn(Alert.prototype, "save").mockRejectedValue(new Error("E11000 duplicate key error collection: fdfsclub.alerts"));
    try {
      const res = await request(app).post("/api/alerts").send(VALID_ALERT_BODY);
      expect(res.status).toBe(500);
      expect(res.body.message).not.toMatch(/E11000|fdfsclub/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("DELETE /api/alerts/:alertId", () => {
  test("cancels an active alert", async () => {
    const alert = await Alert.create({
      user_email: "test@example.com", movie: { id: 100, name: "Test" },
      city: { name: "Test" }, alert_date: new Date(), status: "ACTIVE",
    });

    const res = await request(app).delete(`/api/alerts/${alert._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");
  });

  test("returns 404 for non-existent alert", async () => {
    const res = await request(app).delete("/api/alerts/nonexistent-id");
    expect(res.status).toBe(404);
  });

  test("returns 404 for already ALERTED alert", async () => {
    const alert = await Alert.create({
      user_email: "test@example.com", movie: { id: 100, name: "Test" },
      city: { name: "Test" }, alert_date: new Date(), status: "ALERTED",
    });

    const res = await request(app).delete(`/api/alerts/${alert._id}`);
    expect(res.status).toBe(404);
  });

  test("returns 404 for another user's alert", async () => {
    const alert = await Alert.create({
      user_email: "other@example.com", movie: { id: 100, name: "Test" },
      city: { name: "Test" }, alert_date: new Date(), status: "ACTIVE",
    });

    const res = await request(app).delete(`/api/alerts/${alert._id}`);
    expect(res.status).toBe(404);
  });

  test("does not hard-delete the alert", async () => {
    const alert = await Alert.create({
      user_email: "test@example.com", movie: { id: 100, name: "Test" },
      city: { name: "Test" }, alert_date: new Date(), status: "ACTIVE",
    });

    await request(app).delete(`/api/alerts/${alert._id}`);

    const found = await Alert.findById(alert._id);
    expect(found).not.toBeNull();
    expect(found.status).toBe("CANCELLED");
  });
});

describe("POST /api/alerts/:alertId/restore", () => {
  const ALERT_ID = "11111111-2222-3333-4444-555555555555";
  const makeAlert = (overrides = {}) => Alert.create({
    _id: ALERT_ID, user_email: "test@example.com", movie: { id: 100, name: "Test" },
    city: { name: "Test" }, alert_date: new Date(Date.now() + 86400000), status: "CANCELLED",
    ...overrides,
  });

  test("lets exactly one of a restore and a create take the last free slot", async () => {
    const { MAX_ACTIVE_ALERTS_PER_USER } = require("../../constants/appConstants");
    await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });
    await Movie.create({ contentId: 100, name: "Test Movie" });
    for (let i = 0; i < MAX_ACTIVE_ALERTS_PER_USER - 1; i++) {
      await Alert.create({
        user_email: "test@example.com", movie: { id: 300 + i, name: "Other" },
        city: { name: "Test" }, alert_date: new Date(Date.now() + 86400000), status: "ACTIVE",
      });
    }
    await makeAlert({ movie: { id: 400, name: "Restored" } });
    const before = (await Alert.findById(ALERT_ID).lean()).updated_at;
    const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

    const [restore, create] = await Promise.all([
      request(app).post(`/api/alerts/${ALERT_ID}/restore`),
      request(app).post("/api/alerts").send({ movie: { id: 100 }, city: { name: "Bengaluru" }, alert_date: tomorrow }),
    ]);

    expect([restore.status, create.status].filter((status) => status < 300)).toHaveLength(1);
    expect(await Alert.countDocuments({ user_email: "test@example.com", status: "ACTIVE" })).toBe(MAX_ACTIVE_ALERTS_PER_USER);
    const restored = await Alert.findById(ALERT_ID).lean();
    if (restored.status === "CANCELLED") expect(restored.updated_at.getTime()).toBeLessThanOrEqual(before.getTime() + 1000);
  });

  test("restores an alert cancelled moments ago", async () => {
    await makeAlert();

    const res = await request(app).post(`/api/alerts/${ALERT_ID}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ACTIVE");
    expect((await Alert.findById(ALERT_ID)).status).toBe("ACTIVE");
  });

  test("refuses once the undo window has passed", async () => {
    await makeAlert();
    await Alert.collection.updateOne({ _id: ALERT_ID }, { $set: { updated_at: new Date(Date.now() - 5 * 60 * 1000) } });

    const res = await request(app).post(`/api/alerts/${ALERT_ID}/restore`);
    expect(res.status).toBe(404);
    expect((await Alert.findById(ALERT_ID)).status).toBe("CANCELLED");
  });

  test("refuses alerts that were sent or expired", async () => {
    await makeAlert({ status: "ALERTED" });

    const res = await request(app).post(`/api/alerts/${ALERT_ID}/restore`);
    expect(res.status).toBe(404);
  });

  test("refuses another user's alert", async () => {
    await makeAlert({ user_email: "other@example.com" });

    const res = await request(app).post(`/api/alerts/${ALERT_ID}/restore`);
    expect(res.status).toBe(404);
  });

  test("refuses when the user is already at the active alert limit", async () => {
    const { MAX_ACTIVE_ALERTS_PER_USER } = require("../../constants/appConstants");
    await makeAlert();
    for (let i = 0; i < MAX_ACTIVE_ALERTS_PER_USER; i++) {
      await Alert.create({
        user_email: "test@example.com", movie: { id: 200 + i, name: "Other" },
        city: { name: "Test" }, alert_date: new Date(Date.now() + 86400000), status: "ACTIVE",
      });
    }

    const res = await request(app).post(`/api/alerts/${ALERT_ID}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALERT_LIMIT");
  });
});
