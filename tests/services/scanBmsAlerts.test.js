const { setupTestDB, clearTestDB, teardownTestDB } = require("../setup");
const Alert = require("../../models/Alert");
const AlertNotification = require("../../models/AlertNotification");
const City = require("../../models/City");
const Movie = require("../../models/Movie");
const User = require("../../models/User");
const Venue = require("../../models/Venue");

jest.mock("nodemailer", () => ({
  createTransport: jest.fn().mockReturnValue({ sendMail: jest.fn().mockResolvedValue(true) }),
}));
jest.mock("../../clients/districtClient", () => ({
  getShowtimes: jest.fn(),
  pageExists: jest.fn().mockResolvedValue(null),
  getSeatLayout: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../clients/bmsClient", () => {
  const actual = jest.requireActual("../../clients/bmsClient");
  return {
    ...actual,
    getVenueShowtimes: jest.fn(),
    isPaused: jest.fn().mockReturnValue(false),
    usage: jest.fn().mockReturnValue({ sentToday: 0, dailyCap: 5000 }),
  };
});

const districtClient = require("../../clients/districtClient");
const bmsClient = require("../../clients/bmsClient");
const { bmsVenueId } = require("../../services/bmsVenues");
const { BmsBlockedError } = jest.requireActual("../../clients/bmsClient");
const { clearCache } = require("../../services/bmsShowtimes");
const scanAlerts = require("../../services/scanAlerts");
const scanBmsAlerts = require("../../services/scanBmsAlerts");
const { selectWithinBudget, resetScanState } = require("../../services/scanBmsAlerts");

beforeAll(async () => await setupTestDB());
afterEach(async () => {
  await clearTestDB();
  jest.clearAllMocks();
  clearCache();
  resetScanState();
});
afterAll(async () => await teardownTestDB());

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
tomorrow.setHours(0, 0, 0, 0);
const dateIso = tomorrow.toISOString().split("T")[0];
const dateCode = dateIso.replace(/-/g, "");
const PRASADS = bmsVenueId("PRHN");

function bmsShowtimes(title = "The Paradise") {
  return {
    venue: { code: "PRHN", name: "Prasads Multiplex: Hyderabad" },
    events: [{
      title,
      eventGroup: "EG00434659",
      variants: [{
        child: { EventCode: "ET00436621", EventLanguage: "Telugu", EventDimension: "2D" },
        shows: [{
          SessionId: "256713", ShowDateCode: dateCode, ShowDateTime: `${dateCode}1905`, CutOffDateTime: `${dateCode}1850`,
          AvailStatus: "3", ScreenName: "SCREEN 6",
          Categories: [{ PriceDesc: "EXECUTIVE", AreaCatCode: "0002", CurPrice: "390.00", AvailStatus: "3" }],
        }],
      }],
    }],
  };
}

async function seed({ venues = [] } = {}) {
  await User.create({ email: "test@example.com", name: "Test User" });
  await City.create({ _id: 12, name: "Hyderabad", slug: "hyderabad", latitude: 17.38, longitude: 78.48, bms_region: { code: "HYD", slug: "hyderabad" } });
  await Movie.create({ contentId: 185027, name: "The Paradise" });
  await Venue.create({ _id: 1020777, name: "INOX Kachiguda", city_name: "Hyderabad", cinema_id: "1020777" });
  await Venue.create({ _id: PRASADS, name: "Prasads Multiplex: Hyderabad", city_name: "Hyderabad", cinema_id: "bms:PRHN", source: "bookmyshow", bms_venue_code: "PRHN" });
  const expires = new Date(tomorrow);
  expires.setHours(23, 59, 0, 0);
  return Alert.create({
    user_email: "test@example.com",
    movie: { id: 185027, name: "The Paradise" },
    city: { name: "Hyderabad" },
    venues,
    alert_date: tomorrow,
    expires_at: expires,
  });
}

describe("District scan (every 2 min) never touches BookMyShow", () => {
  test("'any theatre' alerts are matched on District only", async () => {
    const alert = await seed();
    districtClient.getShowtimes.mockResolvedValue({
      cinemas: [{
        cinemaId: 1020777, name: "INOX Kachiguda",
        sessions: [{ sessionId: "d1", showTime: `${dateIso}T12:00`, screenFormat: "2D", language: "Telugu", statusColor: "G", available: 40, areas: [{ price: 200 }] }],
      }],
      dates: [dateIso],
    });

    expect((await scanAlerts()).matches).toBe(1);
    expect(bmsClient.getVenueShowtimes).not.toHaveBeenCalled();
    const notification = await AlertNotification.findOne({ alert_id: alert._id }).lean();
    expect(notification.payload.matches.map((match) => match.source)).toEqual(["district"]);
  });

  test("alerts watching only BookMyShow-only theatres skip the District request", async () => {
    await seed({ venues: [{ id: PRASADS, name: "Prasads Multiplex: Hyderabad", source: "bookmyshow" }] });
    await scanAlerts();
    expect(districtClient.getShowtimes).not.toHaveBeenCalled();
    expect(bmsClient.getVenueShowtimes).not.toHaveBeenCalled();
  });
});

describe("BookMyShow scan (every 10 min)", () => {
  test("an alert on a BookMyShow theatre fires with a BookMyShow booking link and no seat map", async () => {
    const alert = await seed({ venues: [{ id: PRASADS, name: "Prasads Multiplex: Hyderabad", source: "bookmyshow" }] });
    bmsClient.getVenueShowtimes.mockResolvedValue(bmsShowtimes());

    const result = await scanBmsAlerts();

    expect(result.matches).toBe(1);
    expect(result.requests).toBe(1);
    expect(bmsClient.getVenueShowtimes).toHaveBeenCalledWith("PRHN", "HYD", dateCode);
    expect(districtClient.getShowtimes).not.toHaveBeenCalled();
    expect(districtClient.getSeatLayout).not.toHaveBeenCalled();

    const notification = await AlertNotification.findOne({ alert_id: alert._id }).lean();
    const [match] = notification.payload.matches;
    expect(match).toMatchObject({
      venue: "Prasads Multiplex: Hyderabad", source: "bookmyshow", seats_available: null, price: 390,
      screen: "SCREEN 6", screen_format: "2D", language: "Telugu", showtime: `${dateIso}T13:35`,
      booking_url: `https://in.bookmyshow.com/cinemas/hyderabad/prasads-multiplex-hyderabad/buytickets/PRHN/${dateCode}`,
    });
    expect(notification.payload.booking_url).toBe(match.booking_url);
    const updated = await Alert.findById(alert._id);
    expect(updated.status).toBe("ALERTED");
  });

  test("'any theatre' alerts also check BookMyShow-only theatres", async () => {
    const alert = await seed();
    bmsClient.getVenueShowtimes.mockResolvedValue(bmsShowtimes());
    expect((await scanBmsAlerts()).matches).toBe(1);
    expect((await Alert.findById(alert._id)).status).toBe("ALERTED");
  });

  test("an alert already notified by District is not notified again", async () => {
    const alert = await seed();
    await Alert.updateOne({ _id: alert._id }, { $set: { status: "ALERTED" } });
    bmsClient.getVenueShowtimes.mockResolvedValue(bmsShowtimes());
    await scanBmsAlerts();
    expect(bmsClient.getVenueShowtimes).not.toHaveBeenCalled();
    expect(await AlertNotification.countDocuments({ alert_id: alert._id })).toBe(0);
  });

  test("alerts watching only District theatres never call BookMyShow", async () => {
    await seed({ venues: [{ id: 1020777, name: "INOX Kachiguda" }] });
    expect((await scanBmsAlerts()).requests).toBe(0);
    expect(bmsClient.getVenueShowtimes).not.toHaveBeenCalled();
  });

  test("other movies at the BookMyShow theatre do not match", async () => {
    const alert = await seed();
    bmsClient.getVenueShowtimes.mockResolvedValue(bmsShowtimes("Some Other Film"));
    expect((await scanBmsAlerts()).matches).toBe(0);
    expect(await AlertNotification.countDocuments({ alert_id: alert._id })).toBe(0);
  });

  test("a block stops the cycle without further requests", async () => {
    await seed();
    await Venue.create({ _id: bmsVenueId("ABCD"), name: "Second", city_name: "Hyderabad", cinema_id: "bms:ABCD", source: "bookmyshow", bms_venue_code: "ABCD" });
    bmsClient.getVenueShowtimes.mockRejectedValue(new BmsBlockedError("denied"));
    const result = await scanBmsAlerts();
    expect(bmsClient.getVenueShowtimes).toHaveBeenCalledTimes(1);
    expect(result.stoppedBy).toBe("denied");
  });

  test("a paused client skips the whole cycle", async () => {
    await seed();
    bmsClient.isPaused.mockReturnValueOnce(true);
    expect((await scanBmsAlerts()).skipped).toBe("paused");
    expect(bmsClient.getVenueShowtimes).not.toHaveBeenCalled();
  });

  test("the per-cycle budget is respected and the rest rotates in next cycle", async () => {
    await seed();
    for (const code of ["AAAA", "BBBB", "CCCC"]) {
      await Venue.create({ _id: bmsVenueId(code), name: code, city_name: "Hyderabad", cinema_id: `bms:${code}`, source: "bookmyshow", bms_venue_code: code });
    }
    bmsClient.getVenueShowtimes.mockResolvedValue(bmsShowtimes("Nothing Here"));

    const first = await scanBmsAlerts({ budget: 2 });
    expect(first.requests).toBe(2);
    expect(first.deferred).toBe(2);
    clearCache();
    await scanBmsAlerts({ budget: 2 });

    const codes = bmsClient.getVenueShowtimes.mock.calls.map(([code]) => code);
    expect(new Set(codes).size).toBe(4);
  });
});

describe("selectWithinBudget", () => {
  const city = { bms_region: { code: "HYD" } };
  const item = (key, tier, date = "2026-10-01") => ({ key, tier, date, city, venue: { bms_venue_code: key }, alerts: [{}] });

  test("picked theatres get most of the budget but 'any theatre' work is never starved", () => {
    const items = [item("P1", 0), item("P2", 0), item("P3", 0), item("P4", 0), item("A1", 1), item("A2", 1)];
    const { selected, deferred } = selectWithinBudget(items, 4);
    expect(selected.map((i) => i.key)).toEqual(["P1", "P2", "P3", "A1"]);
    expect(deferred).toBe(2);
  });

  test("unused budget spills over to the other tier", () => {
    const items = [item("P1", 0), item("P2", 0), item("P3", 0), item("A1", 1)];
    expect(selectWithinBudget(items, 4).selected.map((i) => i.key)).toEqual(["P1", "P2", "P3", "A1"]);
    const onlyPicked = [item("P1", 0), item("P2", 0), item("P3", 0)];
    expect(selectWithinBudget(onlyPicked, 3).selected).toHaveLength(3);
  });

  test("nearest dates go first", () => {
    const items = [item("LATE", 0, "2026-10-05"), item("SOON", 0, "2026-10-01")];
    expect(selectWithinBudget(items, 1).selected[0].key).toBe("SOON");
  });
});
