const { setupTestDB, clearTestDB, teardownTestDB } = require("../setup");
const Alert = require("../../models/Alert");
const City = require("../../models/City");
const Movie = require("../../models/Movie");
const User = require("../../models/User");
const AlertNotification = require("../../models/AlertNotification");

jest.mock("nodemailer", () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue(true),
  }),
}));

jest.mock("../../clients/districtClient", () => ({
  getShowtimes: jest.fn(),
  pageExists: jest.fn().mockResolvedValue(null),
  getSeatLayout: jest.fn().mockResolvedValue({
    rows: [], availableSeats: 10, totalSeats: 100
  }),
}));
const districtClient = require("../../clients/districtClient");

const scanAlerts = require("../../services/scanAlerts");

beforeAll(async () => await setupTestDB());
afterEach(async () => {
  await clearTestDB();
  jest.clearAllMocks();
});
afterAll(async () => await teardownTestDB());

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
tomorrow.setHours(0, 0, 0, 0);
const tomorrowStr = tomorrow.toISOString().split("T")[0];

const MOCK_SHOWTIME_RESPONSE = {
  cinemas: [
    {
      cinemaId: 500,
      name: "PVR",
      address: "123 St",
      providerId: 10,
      latitude: 12.97,
      longitude: 77.59,
      sessions: [
        {
          sessionId: "s1",
          showTime: `${tomorrowStr}T14:30:00`,
          screen: "Screen 1",
          screenFormat: "2D",
          language: "English",
          available: 50,
          total: 200,
          statusColor: "G",
          areas: [{ price: 250, available: 30 }],
          tags: [],
        },
      ],
    },
  ],
  dates: [tomorrowStr],
};

async function seedBaseData() {
  await User.create({ email: "test@example.com", name: "Test User" });
  await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru", latitude: 12.97, longitude: 77.59 });
  await Movie.create({ contentId: 100, name: "Test Movie" });
}

describe("scanAlerts", () => {
  test("scans active alerts and matches them", async () => {
    await seedBaseData();
    const futureExpiry = new Date(tomorrow);
    futureExpiry.setHours(23, 59, 0, 0);

    await Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test Movie" },
      city: { name: "Bengaluru" },
      alert_date: tomorrow,
      status: "ACTIVE",
      expires_at: futureExpiry,
    });

    districtClient.getShowtimes.mockResolvedValue(MOCK_SHOWTIME_RESPONSE);

    const result = await scanAlerts();

    expect(result.success).toBe(true);
    expect(result.scanned).toBe(1);
    expect(result.matches).toBe(1);

    const alerts = await Alert.find({});
    expect(alerts[0].status).toBe("ALERTED");

    const notifications = await AlertNotification.find({});
    expect(notifications.length).toBe(1);
  });

  test("batches multiple alerts for same movie/city/date into one API call", async () => {
    await seedBaseData();
    const futureExpiry = new Date(tomorrow);
    futureExpiry.setHours(23, 59, 0, 0);

    for (let i = 0; i < 3; i++) {
      await Alert.create({
        user_email: "test@example.com",
        movie: { id: 100, name: "Test Movie" },
        city: { name: "Bengaluru" },
        alert_date: tomorrow,
        status: "ACTIVE",
        expires_at: futureExpiry,
      });
    }

    districtClient.getShowtimes.mockResolvedValue(MOCK_SHOWTIME_RESPONSE);

    const result = await scanAlerts();

    expect(districtClient.getShowtimes).toHaveBeenCalledTimes(1);
    expect(result.batches).toBe(1);
    expect(result.matches).toBe(3);
  });

  test("separate batches for different movies", async () => {
    await seedBaseData();
    await Movie.create({ contentId: 200, name: "Movie 2" });
    const futureExpiry = new Date(tomorrow);
    futureExpiry.setHours(23, 59, 0, 0);

    await Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test Movie" },
      city: { name: "Bengaluru" },
      alert_date: tomorrow,
      status: "ACTIVE",
      expires_at: futureExpiry,
    });
    await Alert.create({
      user_email: "test@example.com",
      movie: { id: 200, name: "Movie 2" },
      city: { name: "Bengaluru" },
      alert_date: tomorrow,
      status: "ACTIVE",
      expires_at: futureExpiry,
    });

    districtClient.getShowtimes.mockResolvedValue(MOCK_SHOWTIME_RESPONSE);

    const result = await scanAlerts();

    expect(districtClient.getShowtimes).toHaveBeenCalledTimes(2);
    expect(result.batches).toBe(2);
  });

  test("does not scan already ALERTED/CANCELLED/EXPIRED alerts", async () => {
    await seedBaseData();
    const futureExpiry = new Date(tomorrow);
    futureExpiry.setHours(23, 59, 0, 0);

    await Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test" },
      city: { name: "Bengaluru" },
      alert_date: tomorrow,
      status: "ALERTED",
      expires_at: futureExpiry,
    });
    await Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test" },
      city: { name: "Bengaluru" },
      alert_date: tomorrow,
      status: "CANCELLED",
      expires_at: futureExpiry,
    });

    const result = await scanAlerts();
    expect(result.scanned).toBe(0);
    expect(districtClient.getShowtimes).not.toHaveBeenCalled();
  });

  test("does not scan alerts with past alert_date", async () => {
    await seedBaseData();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test" },
      city: { name: "Bengaluru" },
      alert_date: yesterday,
      status: "ACTIVE",
      expires_at: new Date(Date.now() + 86400000),
    });

    const result = await scanAlerts();
    expect(result.scanned).toBe(0);
  });

  test("does not scan expired alerts", async () => {
    await seedBaseData();

    await Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test" },
      city: { name: "Bengaluru" },
      alert_date: tomorrow,
      status: "ACTIVE",
      expires_at: new Date(Date.now() - 1000),
    });

    const result = await scanAlerts();
    expect(result.scanned).toBe(0);
  });

  test("updates last_checked_at on scanned alerts", async () => {
    await seedBaseData();
    const futureExpiry = new Date(tomorrow);
    futureExpiry.setHours(23, 59, 0, 0);

    const alert = await Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test Movie" },
      city: { name: "Bengaluru" },
      alert_date: tomorrow,
      status: "ACTIVE",
      expires_at: futureExpiry,
    });

    districtClient.getShowtimes.mockResolvedValue({ cinemas: [], dates: [] });

    await scanAlerts();

    const updatedAlert = await Alert.findById(alert._id);
    expect(updatedAlert.last_checked_at).toBeInstanceOf(Date);
    expect(updatedAlert.status).toBe("ACTIVE");
  });

  test("handles API failure gracefully without crashing", async () => {
    await seedBaseData();
    const futureExpiry = new Date(tomorrow);
    futureExpiry.setHours(23, 59, 0, 0);

    await Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test" },
      city: { name: "Bengaluru" },
      alert_date: tomorrow,
      status: "ACTIVE",
      expires_at: futureExpiry,
    });

    districtClient.getShowtimes.mockRejectedValue(new Error("API error"));

    const result = await scanAlerts();

    expect(result.success).toBe(true);
    expect(result.errors).toBe(0);
    expect(result.matches).toBe(0);
  });

  test("alert with format filter: no match when format missing", async () => {
    await seedBaseData();
    const futureExpiry = new Date(tomorrow);
    futureExpiry.setHours(23, 59, 0, 0);

    await Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test" },
      city: { name: "Bengaluru" },
      alert_date: tomorrow,
      status: "ACTIVE",
      expires_at: futureExpiry,
      filters: { formats: ["4DX"] },
    });

    districtClient.getShowtimes.mockResolvedValue(MOCK_SHOWTIME_RESPONSE);

    const result = await scanAlerts();
    expect(result.matches).toBe(0);

    const alert = await Alert.findOne({});
    expect(alert.status).toBe("ACTIVE");
  });

  test("handles no active alerts gracefully", async () => {
    const result = await scanAlerts();
    expect(result.success).toBe(true);
    expect(result.scanned).toBe(0);
  });
});
