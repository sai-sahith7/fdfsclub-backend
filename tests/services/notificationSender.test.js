const { setupTestDB, clearTestDB, teardownTestDB } = require("../setup");
const Alert = require("../../models/Alert");
const AlertNotification = require("../../models/AlertNotification");
const User = require("../../models/User");
const City = require("../../models/City");
const { sendNotification, checkCityLink } = require("../../services/notificationSender");
const districtClient = require("../../clients/districtClient");

jest.mock("nodemailer", () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue(true),
  }),
}));
jest.mock("../../clients/districtClient");
districtClient.getSeatLayout.mockResolvedValue([
  { areaName: "Executive", rows: {}, availableCount: 10, totalCount: 100 }
]);

beforeAll(async () => await setupTestDB());
beforeEach(() => districtClient.pageExists.mockResolvedValue(null));
afterEach(async () => {
  districtClient.pageExists.mockReset();
  await clearTestDB();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 50));
afterAll(async () => await teardownTestDB());

const MOCK_CINEMA = {
  cinemaId: 500,
  name: "PVR Cinemas",
  address: "123 Main St",
};

const MOCK_SESSION = {
  sessionId: "sess-1",
  showTime: "2024-07-25T14:30:00",
  screen: "Screen 1",
  screenFormat: "IMAX 2D",
  language: "English",
  available: 50,
  areas: [{ price: 350 }, { price: 500 }],
};

async function createTestUser(overrides = {}) {
  return User.create({
    email: "test@example.com",
    name: "Test User",
    ...overrides,
  });
}

async function createTestAlert(overrides = {}) {
  return Alert.create({
    user_email: "test@example.com",
    movie: { id: 100, name: "Test Movie" },
    city: { id: 1, name: "Bengaluru" },
    alert_date: new Date("2024-07-25"),
    status: "ACTIVE",
    ...overrides,
  });
}

describe("sendNotification", () => {
  test("creates email notification and marks alert as ALERTED", async () => {
    await createTestUser();
    const alert = await createTestAlert();

    await sendNotification(alert, [{ cinema: MOCK_CINEMA, session: MOCK_SESSION }]);

    const updatedAlert = await Alert.findById(alert._id);
    expect(updatedAlert.status).toBe("ALERTED");
    expect(updatedAlert.notified_at).toBeInstanceOf(Date);

    const notifications = await AlertNotification.find({ alert_id: alert._id });
    expect(notifications.length).toBe(1);
    expect(notifications[0].channel).toBe("email");
    expect(notifications[0].status).toBe("sent");
    expect(notifications[0].payload.movie).toBe("Test Movie");
    expect(notifications[0].payload.matches[0].venue).toBe("PVR Cinemas");
    expect(notifications[0].payload.matches[0].showtime).toBe("2024-07-25T14:30:00");
    expect(notifications[0].payload.matches[0].screen_format).toBe("IMAX 2D");
  });

  test("creates telegram notification when user has telegram connected", async () => {
    await createTestUser({
      telegram: { chat_id: "12345", username: "testuser", connected: true },
    });
    const alert = await createTestAlert();

    await sendNotification(alert, [{ cinema: MOCK_CINEMA, session: MOCK_SESSION }]);

    const notifications = await AlertNotification.find({ alert_id: alert._id });
    expect(notifications.length).toBe(2);

    const channels = notifications.map((n) => n.channel).sort();
    expect(channels).toEqual(["email", "telegram"]);
  });

  test("idempotency: does not create duplicate notifications", async () => {
    await createTestUser();
    const alert = await createTestAlert();

    await sendNotification(alert, [{ cinema: MOCK_CINEMA, session: MOCK_SESSION }]);

    await sendNotification(alert, [{ cinema: MOCK_CINEMA, session: MOCK_SESSION }]);

    const notifications = await AlertNotification.find({ alert_id: alert._id });
    expect(notifications.length).toBe(1);
  });

  test("two scans racing on the same alert notify exactly once", async () => {
    await createTestUser();
    const alert = await createTestAlert();

    await Promise.all([
      sendNotification(alert, [{ cinema: MOCK_CINEMA, session: MOCK_SESSION }]),
      sendNotification(alert, [{ cinema: MOCK_CINEMA, session: MOCK_SESSION }]),
    ]);

    expect(await AlertNotification.countDocuments({ alert_id: alert._id })).toBe(1);
  });

  test("an alert cancelled mid-scan is not notified", async () => {
    await createTestUser();
    const alert = await createTestAlert();
    await Alert.updateOne({ _id: alert._id }, { $set: { status: "CANCELLED" } });

    await sendNotification(alert, [{ cinema: MOCK_CINEMA, session: MOCK_SESSION }]);

    expect(await AlertNotification.countDocuments({ alert_id: alert._id })).toBe(0);
    expect((await Alert.findById(alert._id)).status).toBe("CANCELLED");
  });

  test("releases the alert when no notification could be created", async () => {
    await createTestUser();
    const alert = await createTestAlert();
    const save = jest.spyOn(AlertNotification.prototype, "save").mockRejectedValue(new Error("db down"));

    try {
      await sendNotification(alert, [{ cinema: MOCK_CINEMA, session: MOCK_SESSION }]);
    } finally {
      save.mockRestore();
    }

    const updated = await Alert.findById(alert._id);
    expect(updated.status).toBe("ACTIVE");
    expect(updated.notified_at).toBeNull();
  });

  test("handles missing user gracefully", async () => {
    const alert = await createTestAlert({ user_email: "nonexistent@example.com" });

    await sendNotification(alert, [{ cinema: MOCK_CINEMA, session: MOCK_SESSION }]);

    const notifications = await AlertNotification.find({});
    expect(notifications.length).toBe(0);
  });

  test("notification payload contains price from cheapest area", async () => {
    await createTestUser();
    const alert = await createTestAlert();

    await sendNotification(alert, [{ cinema: MOCK_CINEMA, session: MOCK_SESSION }]);

    const notification = await AlertNotification.findOne({ alert_id: alert._id });
    expect(notification.payload.matches[0].price).toBe(350);
  });

  test("uses the city link once District has confirmed it for that slug", async () => {
    await createTestUser();
    await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru", district_link_ok: true, district_link_slug: "bengaluru", district_link_checked_at: new Date() });
    const alert = await createTestAlert({ movie: { id: 194537, name: "Spider-Man: Brand New Day" } });

    await sendNotification(alert, [{ cinema: MOCK_CINEMA, session: MOCK_SESSION }]);

    const notification = await AlertNotification.findOne({ alert_id: alert._id });
    const expected = "https://www.district.in/movies/spider-man-brand-new-day-movie-tickets-in-bengaluru-MV194537";
    expect(notification.payload.booking_url).toBe(expected);
    expect(notification.payload.matches[0].booking_url).toBe(expected);
    expect(districtClient.pageExists).not.toHaveBeenCalled();
  });

  test("sends the city-less link right away and checks the city in the background", async () => {
    await createTestUser();
    await City.create({ _id: 2, name: "Pune", slug: "pune" });
    districtClient.pageExists.mockResolvedValue(true);
    const alert = await createTestAlert({ city: { name: "Pune" } });

    await sendNotification(alert, [{ cinema: MOCK_CINEMA, session: MOCK_SESSION }]);
    await flush();

    const notification = await AlertNotification.findOne({ alert_id: alert._id });
    expect(notification.payload.booking_url).toBe("https://www.district.in/movies/test-movie-movie-tickets-MV100");
    const city = await City.findById(2).lean();
    expect(city.district_link_ok).toBe(true);
    expect(city.district_link_slug).toBe("pune");
  });

  test("uses the city-less link when the city is not in the DB", async () => {
    await createTestUser();
    const alert = await createTestAlert({ city: { name: "Delhi NCR" } });

    await sendNotification(alert, [{ cinema: MOCK_CINEMA, session: MOCK_SESSION }]);

    const notification = await AlertNotification.findOne({ alert_id: alert._id });
    expect(notification.payload.booking_url).toBe("https://www.district.in/movies/test-movie-movie-tickets-MV100");
  });

  test("ignores a cached result for a different slug", async () => {
    await createTestUser();
    await City.create({ _id: 3, name: "Kochi", slug: "kochi", district_link_ok: true, district_link_slug: "cochin", district_link_checked_at: new Date() });
    const alert = await createTestAlert({ city: { name: "Kochi" } });

    await sendNotification(alert, [{ cinema: MOCK_CINEMA, session: MOCK_SESSION }]);
    await flush();

    const notification = await AlertNotification.findOne({ alert_id: alert._id });
    expect(notification.payload.booking_url).toBe("https://www.district.in/movies/test-movie-movie-tickets-MV100");
    expect(districtClient.pageExists).toHaveBeenCalled();
  });

  test("skips the District link entirely for BookMyShow-only matches", async () => {
    await createTestUser();
    await City.create({ _id: 4, name: "Bengaluru", slug: "bengaluru" });
    const alert = await createTestAlert();
    const bmsSession = { ...MOCK_SESSION, source: "bookmyshow", bookingUrl: "https://in.bookmyshow.com/cinemas/bengaluru/x/buytickets/ABCD/20261102" };

    await sendNotification(alert, [{ cinema: MOCK_CINEMA, session: bmsSession }]);
    await flush();

    const notification = await AlertNotification.findOne({ alert_id: alert._id });
    expect(notification.payload.booking_url).toBe(bmsSession.bookingUrl);
    expect(districtClient.pageExists).not.toHaveBeenCalled();
  });

  describe("checkCityLink", () => {
    const urls = ["https://www.district.in/movies/a-movie-tickets-in-belghoria-MV1", "https://www.district.in/movies/a-movie-tickets-MV1"];

    test("remembers a city District has no page for", async () => {
      const city = (await City.create({ _id: 10, name: "Belghoria", slug: "belghoria" })).toObject();
      districtClient.pageExists.mockImplementation(async (url) => !url.includes("-in-belghoria-"));

      await checkCityLink(city, ...urls);

      const saved = await City.findById(10).lean();
      expect(saved.district_link_ok).toBe(false);
      expect(saved.district_link_slug).toBe("belghoria");
    });

    test("keeps the last known answer when District can't be reached", async () => {
      const city = (await City.create({ _id: 11, name: "Chennai", slug: "chennai", district_link_ok: true, district_link_slug: "chennai", district_link_checked_at: new Date(0) })).toObject();
      districtClient.pageExists.mockResolvedValue(null);

      await checkCityLink(city, ...urls);

      const saved = await City.findById(11).lean();
      expect(saved.district_link_ok).toBe(true);
      expect(saved.district_link_checked_at.getTime()).toBeGreaterThan(0);
    });

    test("does not blame the city when the movie page is gone too", async () => {
      const city = (await City.create({ _id: 12, name: "Mumbai", slug: "mumbai" })).toObject();
      districtClient.pageExists.mockResolvedValue(false);

      await checkCityLink(city, ...urls);

      expect((await City.findById(12).lean()).district_link_ok).toBeNull();
    });

    test("only one check runs at a time for a city", async () => {
      const city = (await City.create({ _id: 13, name: "Pune", slug: "pune" })).toObject();
      districtClient.pageExists.mockResolvedValue(true);

      await Promise.all([checkCityLink(city, ...urls), checkCityLink(city, ...urls)]);

      expect(districtClient.pageExists).toHaveBeenCalledTimes(1);
    });
  });

  test("notification stores screen and language info", async () => {
    await createTestUser();
    const alert = await createTestAlert();

    await sendNotification(alert, [{
      cinema: MOCK_CINEMA,
      session: {
        ...MOCK_SESSION,
        screen: "Audi 3",
        language: "Hindi",
      }
    }]);

    const notification = await AlertNotification.findOne({ alert_id: alert._id });
    expect(notification.payload.matches[0].screen).toBe("Audi 3");
    expect(notification.payload.matches[0].language).toBe("Hindi");
  });
});
