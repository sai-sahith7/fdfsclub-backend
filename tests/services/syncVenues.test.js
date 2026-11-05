

const { setupTestDB, clearTestDB, teardownTestDB } = require("../setup");
const City = require("../../models/City");
const Venue = require("../../models/Venue");

jest.mock("../../clients/districtClient", () => ({
  getAllCinemas: jest.fn(),
}));
const districtClient = require("../../clients/districtClient");

const syncVenues = require("../../services/syncVenues");
const { syncVenuesForCity } = require("../../services/syncVenues");

beforeAll(async () => await setupTestDB());
afterEach(async () => {
  await clearTestDB();
  jest.clearAllMocks();
});
afterAll(async () => await teardownTestDB());

describe("syncVenuesForCity", () => {
  test("upserts venues for a city", async () => {
    const city = await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });

    districtClient.getAllCinemas.mockResolvedValue([
      { cinemaId: 100, name: "PVR Cinemas", address: "123 Main St", providerId: 10, latitude: 12.97, longitude: 77.59, amenities: ["parking"] },
      { cinemaId: 200, name: "Cinepolis", address: "456 Elm St", providerId: 20, latitude: 12.98, longitude: 77.60, amenities: [] },
    ]);

    const result = await syncVenuesForCity(city);

    expect(result.success).toBe(true);
    expect(result.venues).toBe(2);

    const venues = await Venue.find({});
    expect(venues.length).toBe(2);

    const pvr = await Venue.findOne({ cinema_id: "100" });
    expect(pvr.name).toBe("PVR Cinemas");
    expect(pvr.city_name).toBe("Bengaluru");
  });

  test("handles empty cinemas response", async () => {
    const city = await City.create({ _id: 1, name: "Empty", slug: "empty" });
    districtClient.getAllCinemas.mockResolvedValue([]);

    const result = await syncVenuesForCity(city);
    expect(result.success).toBe(true);
    expect(result.venues).toBe(0);
  });

  test("handles API failure", async () => {
    const city = await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });
    districtClient.getAllCinemas.mockRejectedValue(new Error("API timeout"));

    const result = await syncVenuesForCity(city);
    expect(result.success).toBe(false);
    expect(result.error).toBe("API timeout");
  });

  test("updates existing venues on re-sync", async () => {
    const city = await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });

    districtClient.getAllCinemas.mockResolvedValue([
      { cinemaId: 100, name: "Old Name", address: "Old Addr", providerId: 10, latitude: 0, longitude: 0, amenities: [] },
    ]);
    await syncVenuesForCity(city);

    districtClient.getAllCinemas.mockResolvedValue([
      { cinemaId: 100, name: "New Name", address: "New Addr", providerId: 10, latitude: 12.97, longitude: 77.59, amenities: ["wifi"] },
    ]);
    await syncVenuesForCity(city);

    const venues = await Venue.find({});
    expect(venues.length).toBe(1);
    expect(venues[0].name).toBe("New Name");
  });
});

describe("syncVenues (all cities)", () => {
  test("only syncs active cities", async () => {
    await City.create({ _id: 1, name: "Active", slug: "active", is_active: true });
    await City.create({ _id: 2, name: "Inactive", slug: "inactive", is_active: false });

    districtClient.getAllCinemas.mockResolvedValue([]);

    await syncVenues();

    expect(districtClient.getAllCinemas).toHaveBeenCalledTimes(1);
  });
});
