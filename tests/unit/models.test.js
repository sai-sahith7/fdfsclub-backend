const { setupTestDB, clearTestDB, teardownTestDB } = require("../setup");

const City = require("../../models/City");
const Movie = require("../../models/Movie");
const Alert = require("../../models/Alert");
const AlertNotification = require("../../models/AlertNotification");
const User = require("../../models/User");
const Venue = require("../../models/Venue");

beforeAll(async () => await setupTestDB());
afterEach(async () => await clearTestDB());
afterAll(async () => await teardownTestDB());

describe("City model", () => {
  test("creates a valid city", async () => {
    const city = await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });
    expect(city._id).toBe(1);
    expect(city.is_active).toBe(true);
    expect(city.last_movie_sync_at).toBeNull();
  });

  test("requires name", async () => {
    await expect(City.create({ _id: 2, slug: "test" })).rejects.toThrow();
  });

  test("requires slug", async () => {
    await expect(City.create({ _id: 3, name: "Test" })).rejects.toThrow();
  });

  test("enforces unique (slug, state_key) composite pair", async () => {
    await City.create({ _id: 1, name: "City A", slug: "cityslug", state_key: "state-1" });

    await expect(
      City.create({ _id: 2, name: "City B", slug: "cityslug", state_key: "state-2" })
    ).resolves.toBeDefined();

    await expect(
      City.create({ _id: 3, name: "City C", slug: "cityslug", state_key: "state-1" })
    ).rejects.toThrow();

    await City.create({ _id: 4, name: "City D", slug: "cityslug2" });
    await expect(
      City.create({ _id: 5, name: "City E", slug: "cityslug2" })
    ).rejects.toThrow();
  });

  test("defaults is_active to true", async () => {
    const city = await City.create({ _id: 4, name: "Test City", slug: "test-city" });
    expect(city.is_active).toBe(true);
  });

  test("allows latitude and longitude", async () => {
    const city = await City.create({
      _id: 5, name: "Test", slug: "test5", latitude: 12.97, longitude: 77.59,
    });
    expect(city.latitude).toBe(12.97);
    expect(city.longitude).toBe(77.59);
  });
});

describe("Movie model", () => {
  test("creates a valid movie", async () => {
    const movie = await Movie.create({
      contentId: 100,
      name: "Test Movie",
      frmtids: ["fmt1", "fmt2"],
      release_date: "2024-07-25",
      booking_status: "NOW_SHOWING",
    });
    expect(movie.contentId).toBe(100);
    expect(movie.frmtids).toEqual(["fmt1", "fmt2"]);
    expect(movie.release_date).toBe("2024-07-25");
    expect(movie.booking_status).toBe("NOW_SHOWING");
  });

  test("requires name", async () => {
    await expect(Movie.create({ contentId: 101 })).rejects.toThrow();
  });

  test("defaults frmtids to empty array", async () => {
    const movie = await Movie.create({ contentId: 102, name: "Test" });
    expect(movie.frmtids).toEqual([]);
  });

  test("sets timestamps", async () => {
    const movie = await Movie.create({ contentId: 103, name: "Test" });
    expect(movie.created_at).toBeInstanceOf(Date);
    expect(movie.updated_at).toBeInstanceOf(Date);
  });

  test("stores extras fields", async () => {
    const movie = await Movie.create({
      contentId: 104,
      name: "Test",
      extras: { genres: ["Action", "Comedy"], language_variants: ["English", "Hindi"] },
    });
    expect(movie.extras.genres).toEqual(["Action", "Comedy"]);
    expect(movie.extras.language_variants).toEqual(["English", "Hindi"]);
  });
});

describe("Alert model", () => {
  test("creates a valid alert with UUID _id", async () => {
    const alert = await Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test Movie" },
      city: { name: "Bengaluru" },
      alert_date: new Date("2024-07-25"),
    });
    expect(alert._id).toBeTruthy();
    expect(alert.status).toBe("ACTIVE");
    expect(alert.last_scan_group_key).toBeNull();
  });

  test("requires user_email", async () => {
    await expect(Alert.create({
      movie: { id: 100, name: "Test" },
      city: { name: "Test" },
      alert_date: new Date(),
    })).rejects.toThrow();
  });

  test("requires movie.id and movie.name", async () => {
    await expect(Alert.create({
      user_email: "test@example.com",
      city: { name: "Test" },
      alert_date: new Date(),
    })).rejects.toThrow();
  });

  test("requires alert_date", async () => {
    await expect(Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test" },
      city: { name: "Test" },
    })).rejects.toThrow();
  });

  test("validates status enum", async () => {
    await expect(Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test" },
      city: { name: "Test" },
      alert_date: new Date(),
      status: "INVALID_STATUS",
    })).rejects.toThrow();
  });

  test("allows all valid statuses", async () => {
    for (const status of ["ACTIVE", "ALERTED", "CANCELLED", "EXPIRED"]) {
      const alert = await Alert.create({
        user_email: "test@example.com",
        movie: { id: 100, name: "Test" },
        city: { name: "Test" },
        alert_date: new Date(),
        status,
      });
      expect(alert.status).toBe(status);
    }
  });

  test("stores filters correctly", async () => {
    const alert = await Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test" },
      city: { name: "Test" },
      alert_date: new Date(),
      filters: {
        formats: ["IMAX 2D"],
        languages: ["English"],
        show_time_min: 600,
        show_time_max: 1200,
        price_min: 200,
        price_max: 500,
      },
    });
    expect(alert.filters.formats).toEqual(["IMAX 2D"]);
    expect(alert.filters.show_time_min).toBe(600);
    expect(alert.filters.price_max).toBe(500);
  });

  test("stores last_scan_group_key", async () => {
    const alert = await Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test" },
      city: { name: "Bengaluru" },
      alert_date: new Date(),
      last_scan_group_key: "100:Bengaluru:2024-07-25",
    });
    expect(alert.last_scan_group_key).toBe("100:Bengaluru:2024-07-25");
  });

  test("lowercases user_email", async () => {
    const alert = await Alert.create({
      user_email: "TEST@Example.COM",
      movie: { id: 100, name: "Test" },
      city: { name: "Test" },
      alert_date: new Date(),
    });
    expect(alert.user_email).toBe("test@example.com");
  });
});

describe("AlertNotification model", () => {
  test("creates a valid notification", async () => {
    const notif = await AlertNotification.create({
      alert_id: "alert-1",
      channel: "email",
      payload: { movie: "Test Movie", venue: "PVR" },
    });
    expect(notif._id).toBeTruthy();
    expect(notif.status).toBe("pending");
    expect(notif.retry_count).toBe(0);
  });

  test("validates channel enum", async () => {
    await expect(AlertNotification.create({
      alert_id: "alert-1",
      channel: "sms",
    })).rejects.toThrow();
  });

  test("allows email and telegram channels", async () => {
    const n1 = await AlertNotification.create({ alert_id: "a1", channel: "email" });
    const n2 = await AlertNotification.create({ alert_id: "a2", channel: "telegram" });
    expect(n1.channel).toBe("email");
    expect(n2.channel).toBe("telegram");
  });

  test("validates status enum", async () => {
    await expect(AlertNotification.create({
      alert_id: "alert-1",
      channel: "email",
      status: "invalid",
    })).rejects.toThrow();
  });

  test("allows all valid statuses", async () => {
    for (const status of ["pending", "sent", "failed", "dead"]) {
      const n = await AlertNotification.create({ alert_id: "a1", channel: "email", status });
      expect(n.status).toBe(status);
    }
  });

  test("stores retry_count", async () => {
    const notif = await AlertNotification.create({
      alert_id: "a1", channel: "email", retry_count: 3,
    });
    expect(notif.retry_count).toBe(3);
  });

  test("stores full payload", async () => {
    const notif = await AlertNotification.create({
      alert_id: "a1",
      channel: "email",
      payload: {
        movie: "Test",
        matches: [{
          venue: "PVR",
          showtime: "14:30",
          screen: "Screen 1",
          screen_format: "IMAX",
          language: "English",
          seats_available: 50,
          price: 350,
          booking_url: "https://example.com",
        }],
      },
    });
    expect(notif.payload.movie).toBe("Test");
    expect(notif.payload.matches[0].seats_available).toBe(50);
    expect(notif.payload.matches[0].booking_url).toBe("https://example.com");
  });
});

describe("User model", () => {
  test("creates a valid user", async () => {
    const user = await User.create({ email: "test@example.com", name: "Test User" });
    expect(user.email).toBe("test@example.com");
    expect(user.default_city.name).toBeNull();
    expect(user.telegram.connected).toBe(false);
  });

  test("requires email", async () => {
    await expect(User.create({ name: "Test" })).rejects.toThrow();
  });

  test("requires name", async () => {
    await expect(User.create({ email: "test@example.com" })).rejects.toThrow();
  });

  test("lowercases email", async () => {
    const user = await User.create({ email: "TEST@Example.com", name: "Test" });
    expect(user.email).toBe("test@example.com");
  });

  test("enforces unique email", async () => {
    await User.create({ email: "test@example.com", name: "User 1" });
    await expect(User.create({ email: "test@example.com", name: "User 2" })).rejects.toThrow();
  });

  test("stores default_city", async () => {
    const user = await User.create({
      email: "test@example.com",
      name: "Test",
      default_city: { name: "Bengaluru", slug: "bengaluru" },
    });
    expect(user.default_city.name).toBe("Bengaluru");
    expect(user.default_city.slug).toBe("bengaluru");
  });

  test("stores telegram info", async () => {
    const user = await User.create({
      email: "test@example.com",
      name: "Test",
      telegram: { chat_id: "12345", username: "testuser", connected: true },
    });
    expect(user.telegram.connected).toBe(true);
    expect(user.telegram.chat_id).toBe("12345");
  });
});

describe("Venue model", () => {
  test("creates a valid venue", async () => {
    const venue = await Venue.create({
      _id: 1000, name: "PVR Cinemas", city_name: "Bengaluru",
      location: { type: "Point", coordinates: [77.59, 12.97] },
    });
    expect(venue.name).toBe("PVR Cinemas");
    expect(venue.location.coordinates).toEqual([77.59, 12.97]);
  });

  test("requires name", async () => {
    await expect(Venue.create({ _id: 1001, city_name: "Bengaluru" })).rejects.toThrow();
  });

  test("requires city_name", async () => {
    await expect(Venue.create({ _id: 1002, name: "Test" })).rejects.toThrow();
  });

  test("stores amenities in extras", async () => {
    const venue = await Venue.create({
      _id: 1003, name: "Test", city_name: "Bengaluru",
      extras: { amenities: ["parking", "food_court"] },
    });
    expect(venue.extras.amenities).toEqual(["parking", "food_court"]);
  });
});
