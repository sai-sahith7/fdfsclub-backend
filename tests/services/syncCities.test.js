const { setupTestDB, clearTestDB, teardownTestDB } = require("../setup");
const City = require("../../models/City");

jest.mock("../../clients/districtClient", () => ({
  getCities: jest.fn(),
}));
const districtClient = require("../../clients/districtClient");
const syncCities = require("../../services/syncCities");

beforeAll(async () => await setupTestDB());
afterEach(async () => {
  await clearTestDB();
  jest.clearAllMocks();
});
afterAll(async () => await teardownTestDB());

describe("syncCities", () => {
  test("upserts cities from API response", async () => {
    districtClient.getCities.mockResolvedValue([
      { id: 1, name: "Bengaluru", value: "bengaluru", lat: 12.97, lon: 77.59 },
      { id: 2, name: "Mumbai", value: "mumbai", lat: 19.07, lon: 72.87 },
      { id: 3, name: "Delhi", value: "delhi", lat: 28.61, lon: 77.20 },
      { id: 4, name: "Chennai", value: "chennai", lat: 13.08, lon: 80.27 },
      { id: 5, name: "Hyderabad", value: "hyderabad", lat: 17.38, lon: 78.48 },
      { id: 6, name: "Kolkata", value: "kolkata", lat: 22.57, lon: 88.36 },
      { id: 7, name: "Pune", value: "pune", lat: 18.52, lon: 73.85 },
      { id: 8, name: "Ahmedabad", value: "ahmedabad", lat: 23.02, lon: 72.57 },
      { id: 9, name: "Jaipur", value: "jaipur", lat: 26.91, lon: 75.78 },
      { id: 10, name: "Lucknow", value: "lucknow", lat: 26.84, lon: 80.94 },
    ]);

    const result = await syncCities();

    expect(result.success).toBe(true);
    expect(result.upserted).toBe(10);

    const cities = await City.find({});
    expect(cities.length).toBe(10);

    const blr = await City.findById(1);
    expect(blr.name).toBe("Bengaluru");
    expect(blr.slug).toBe("bengaluru");
    expect(blr.is_active).toBe(true);
  });

  test("updates existing cities without duplicating", async () => {
    await City.create({ _id: 1, name: "Bangalore", slug: "bangalore", is_active: true });

    districtClient.getCities.mockResolvedValue([
      { id: 1, name: "Bengaluru", value: "bengaluru", lat: 12.97, lon: 77.59 },
      ...Array.from({ length: 9 }, (_, i) => ({
        id: i + 2, name: `City ${i + 2}`, value: `city-${i + 2}`, lat: 0, lon: 0,
      })),
    ]);

    await syncCities();

    const cities = await City.find({});
    expect(cities.length).toBe(10);

    const blr = await City.findById(1);
    expect(blr.name).toBe("Bengaluru");
    expect(blr.slug).toBe("bengaluru");
  });

  test("does not mark removed cities as inactive", async () => {
    await City.create({ _id: 1, name: "City A", slug: "a", is_active: true });
    await City.create({ _id: 2, name: "City B", slug: "b", is_active: true });

    districtClient.getCities.mockResolvedValue([
      { id: 1, name: "City A", value: "a", lat: 0, lon: 0 },
      ...Array.from({ length: 9 }, (_, i) => ({
        id: i + 10, name: `City ${i + 10}`, value: `city-${i + 10}`, lat: 0, lon: 0,
      })),
    ]);

    await syncCities();

    const cityB = await City.findById(2);
    expect(cityB.is_active).toBe(true);

    const cityA = await City.findById(1);
    expect(cityA.is_active).toBe(true);
  });

  test("aborts on suspiciously few cities (sanity check)", async () => {
    districtClient.getCities.mockResolvedValue([
      { id: 1, name: "Only City", value: "only" },
    ]);

    const result = await syncCities();
    expect(result.success).toBe(false);
    expect(result.error).toContain("Too few cities");
  });

  test("handles API failure gracefully", async () => {
    districtClient.getCities.mockRejectedValue(new Error("Network error"));

    const result = await syncCities();
    expect(result.success).toBe(false);
    expect(result.error).toBe("Network error");
  });

  test("re-activates previously inactive city when it reappears", async () => {
    await City.create({ _id: 1, name: "City A", slug: "a", is_active: false });

    districtClient.getCities.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: i + 1, name: `City ${i + 1}`, value: `city-${i + 1}`, lat: 0, lon: 0,
      }))
    );

    districtClient.getCities.mockResolvedValueOnce([
      { id: 1, name: "City A", value: "a", lat: 0, lon: 0 },
      ...Array.from({ length: 9 }, (_, i) => ({
        id: i + 2, name: `City ${i + 2}`, value: `city-${i + 2}`, lat: 0, lon: 0,
      })),
    ]);

    await syncCities();

    const city = await City.findById(1);
    expect(city.is_active).toBe(true);
  });
});
