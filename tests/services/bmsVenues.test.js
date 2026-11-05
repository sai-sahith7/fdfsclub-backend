const { setupTestDB, clearTestDB, teardownTestDB } = require("../setup");
const Alert = require("../../models/Alert");
const City = require("../../models/City");
const Venue = require("../../models/Venue");
const { syncBmsVenuesForCity, reconcileBmsVenues, isSameVenue, bmsVenueId } = require("../../services/bmsVenues");
const { BmsBlockedError } = require("../../clients/bmsClient");

beforeAll(async () => await setupTestDB());
afterEach(async () => await clearTestDB());
afterAll(async () => await teardownTestDB());

const at = (lat, lng) => ({ type: "Point", coordinates: [lng, lat] });
const district = (name, lat, lng) => ({ name, location: at(lat, lng) });

describe("isSameVenue", () => {
  test.each([
    ["PVR: Next Galleria Mall, Panjagutta", "PVR Next Galleria Mall, Panjagutta, Hyderabad"],
    ["INOX: Odeon 4K, LASER, ATMOS, DTS-X: RTC X Roads", "INOX Odeon 4K LASER, Dolby ATMOS, DTS-X, RTC X Roads"],
    ["Miraj Cinemas: Geeta, Chandanagar", "Miraj Cinemas : Geeta, Chandanagar"],
    ["Prasads Multiplex: Hyderabad", "Prasads Multiplex, Hyderabad"],
  ])("same cinema by name: %s", (bms, districtName) => {
    expect(isSameVenue({ name: bms }, district(districtName, 0, 0), ["hyderabad"])).toBe(true);
  });

  test.each([
    ["Cinepolis: Binnypet Mall", 12.9676, 77.5584, "Cinepolis ETA Namma Mall, Binny Pete, Bengaluru", 12.965994, 77.561947],
    ["Gowrishankar DOLBY 7.1 RGB Laser: Attibele", 12.7792, 77.7707, "Gowri Shankar Dolby Atmos Mini Attibele, Bengaluru", 12.77925, 77.77063],
    ["VaibhavCinemas RGBLaser4K Projection:Doddaballapur", 13.2921, 77.5376, "Vaibhav Cinemas RGB Laser 4K Projection, Doddaballapur", 13.29215, 77.53748],
  ])("same cinema despite spelling: %s", (bms, lat, lng, districtName, dLat, dLng) => {
    expect(isSameVenue({ name: bms, latitude: lat, longitude: lng }, district(districtName, dLat, dLng), ["bengaluru"])).toBe(true);
  });

  test("short chain names still need an exact match", () => {
    expect(isSameVenue({ name: "PVR: Forum Mall" }, district("PVRX Forum Mall", 0, 0))).toBe(false);
  });

  test("same cinema by location when names differ", () => {
    const venue = district("Sri Lakshmi Kalamandir 70MM A/C, Alwal, Hyderabad", 17.5031, 78.5102);
    expect(isSameVenue({ name: "Lakshmi Kala Mandir: Alwal", latitude: 17.50313, longitude: 78.51022 }, venue, ["hyderabad"])).toBe(true);
  });

  test("neighbouring cinemas at RTC X Roads stay separate", () => {
    const devi = district("Devi 70MM 4K Laser & Dolby Atmos, RTC X Roads, Hyderabad", 17.4071, 78.4975);
    for (const name of ["Sandhya 70MM 4K Dolby Atmos: RTC X Roads", "Saptagiri 70MM 4K & Dolby Digital: RTC X Roads"]) {
      expect(isSameVenue({ name, latitude: 17.407, longitude: 78.4976 }, devi, ["hyderabad"])).toBe(false);
    }
  });

  test("honorifics do not make different cinemas one chain", () => {
    const venue = district("Sri Krishna 70MM AC, Aliabad, Hyderabad", 17.35, 78.47);
    expect(isSameVenue({ name: "Sri Lakshmi 70MM: Aliabad", latitude: 17.3501, longitude: 78.4701 }, venue, ["hyderabad"])).toBe(false);
  });

  test("same name in a different part of town is a different branch", () => {
    const venue = district("Aparna Cinemas, Nallagandla", 17.4669, 78.3104);
    expect(isSameVenue({ name: "Aparna Cinemas: Nallagandla", latitude: 17.2859, longitude: 78.4141 }, venue)).toBe(false);
  });
});

describe("bmsVenueId", () => {
  test("is negative, stable and reversible", () => {
    expect(bmsVenueId("PRHN")).toBe(-parseInt("prhn", 36));
    expect(bmsVenueId("PRHN")).toBe(bmsVenueId("prhn"));
    expect(bmsVenueId("PRHN")).toBeLessThan(0);
    expect(() => bmsVenueId("../x")).toThrow();
  });
});

describe("syncBmsVenuesForCity", () => {
  async function seed() {
    const city = await City.create({ _id: 12, name: "Hyderabad", slug: "hyderabad", bms_region: { code: "HYD", slug: "hyderabad" } });
    await Venue.create({ _id: 1020777, name: "INOX Maheshwari Parmeshwari Mall, Kachiguda, Hyderabad", city_name: "Hyderabad", cinema_id: "1020777", provider_id: 1707, location: at(17.3907, 78.4884) });
    return city;
  }

  const client = (overrides = {}) => ({
    getRegions: jest.fn(),
    getCityMovies: jest.fn().mockResolvedValue([{ eventCode: "ET1" }, { eventCode: "ET2" }]),
    getVenuesForEvent: jest.fn().mockImplementation(async (code) => code === "ET1"
      ? [{ code: "IMMH", name: "INOX: Maheshwari Parmeshwari Mall, Kachiguda" }, { code: "PRHN", name: "Prasads Multiplex: Hyderabad" }]
      : [{ code: "PRHN", name: "Prasads Multiplex: Hyderabad" }]),
    getVenueShowtimes: jest.fn().mockResolvedValue({
      venue: { code: "PRHN", name: "Prasads Multiplex: Hyderabad", address: "Khairtabad", latitude: 17.4128, longitude: 78.4658, chain: "PRASADS", amenities: ["WC", "CAR", "FOD"] },
      events: [],
    }),
    ...overrides,
  });

  test("stores only cinemas District does not list, and leaves District venues untouched", async () => {
    const city = await seed();
    const before = await Venue.findById(1020777).lean();
    const bms = client();

    const result = await syncBmsVenuesForCity(city, { client: bms, dateCode: "20260928" });

    expect(result).toMatchObject({ success: true, seen: 2, common: 1, venues: 1 });
    expect(bms.getVenueShowtimes).toHaveBeenCalledTimes(1);
    expect(await Venue.findById(1020777).lean()).toEqual(before);

    const prasads = await Venue.findOne({ source: "bookmyshow" }).lean();
    expect(prasads).toMatchObject({
      _id: bmsVenueId("PRHN"), name: "Prasads Multiplex: Hyderabad", address: "Khairtabad", city_name: "Hyderabad",
      cinema_id: "bms:PRHN", bms_venue_code: "PRHN", location: { coordinates: [78.4658, 17.4128] },
      extras: { chain: "PRASADS", amenities: ["2", "3"] },
    });
    expect((await City.findById(12)).last_bms_sync_at).toBeInstanceOf(Date);
  });

  test("re-running does not refetch venues it already stored", async () => {
    const city = await seed();
    const bms = client();
    await syncBmsVenuesForCity(city, { client: bms, dateCode: "20260928" });
    await syncBmsVenuesForCity(city, { client: bms, dateCode: "20260928" });
    expect(bms.getVenueShowtimes).toHaveBeenCalledTimes(1);
    expect(await Venue.countDocuments({ source: "bookmyshow" })).toBe(1);
  });

  test("resolves and stores the BookMyShow region once", async () => {
    const city = await City.create({ _id: 12, name: "Hyderabad", slug: "hyderabad" });
    const bms = client({
      getRegions: jest.fn().mockResolvedValue([{ code: "HYD", name: "Hyderabad", slug: "hyderabad", aliases: [] }]),
      getCityMovies: jest.fn().mockResolvedValue([]),
    });
    await syncBmsVenuesForCity(city, { client: bms });
    expect((await City.findById(12).lean()).bms_region).toEqual({ code: "HYD", slug: "hyderabad" });
    expect(bms.getCityMovies).toHaveBeenCalledWith("hyderabad", "HYD");
  });

  test("a block stops the sync without storing anything", async () => {
    const city = await seed();
    const bms = client({ getVenuesForEvent: jest.fn().mockRejectedValue(new BmsBlockedError("denied")) });
    const result = await syncBmsVenuesForCity(city, { client: bms });
    expect(result.success).toBe(false);
    expect(await Venue.countDocuments({ source: "bookmyshow" })).toBe(0);
  });
});

describe("reconcileBmsVenues", () => {
  test("District wins: the BookMyShow copy is retired and alerts move to the District venue", async () => {
    const city = await City.create({ _id: 12, name: "Hyderabad", slug: "hyderabad" });
    const bmsId = bmsVenueId("PRHN");
    await Venue.create({ _id: bmsId, name: "Prasads Multiplex: Hyderabad", city_name: "Hyderabad", cinema_id: "bms:PRHN", source: "bookmyshow", bms_venue_code: "PRHN", location: at(17.4128, 78.4658) });
    await Venue.create({ _id: 9001, name: "Prasads Multiplex, Hyderabad", city_name: "Hyderabad", cinema_id: "9001", location: at(17.4128, 78.4658) });

    const base = { user_email: "a@b.c", movie: { id: 1, name: "M" }, city: { name: "Hyderabad" }, alert_date: new Date() };
    const onlyBms = await Alert.create({ ...base, venues: [{ id: bmsId, name: "Prasads Multiplex: Hyderabad", source: "bookmyshow" }] });
    const both = await Alert.create({ ...base, venues: [{ id: bmsId, name: "x", source: "bookmyshow" }, { id: 9001, name: "Prasads Multiplex, Hyderabad" }] });

    expect(await reconcileBmsVenues(city)).toEqual({ retired: 1 });
    expect(await Venue.findById(bmsId)).toBeNull();
    expect(await Venue.findById(9001)).not.toBeNull();
    expect((await Alert.findById(onlyBms._id).lean()).venues).toEqual([{ id: 9001, name: "Prasads Multiplex, Hyderabad", source: "district" }]);
    expect((await Alert.findById(both._id).lean()).venues.map((venue) => venue.id)).toEqual([9001]);
  });
});
