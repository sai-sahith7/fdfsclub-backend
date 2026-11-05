const logger = require("../../utils/logger");

jest.mock("node-cron", () => ({ schedule: jest.fn() }));
const cron = require("node-cron");
const { startScheduler } = require("../../workers/scheduler");

const expressions = {};

beforeAll(() => {
  const names = [];
  jest.spyOn(logger, "info").mockImplementation((tag, message) => {
    const match = /•\s+(\S+)/.exec(message || "");
    if (match) names.push(match[1]);
  });
  startScheduler();
  cron.schedule.mock.calls.forEach(([expression], i) => { expressions[names[i]] = expression; });
});

const minutesOf = (name) => expressions[name].split(" ")[0].split(",").map(Number);

test("every job has a cron expression node-cron accepts", () => {
  const { validate } = jest.requireActual("node-cron");
  expect(Object.keys(expressions).length).toBeGreaterThan(0);
  Object.values(expressions).forEach((expression) => expect(validate(expression)).toBe(true));
});

test("ScanBmsAlerts runs at :03, :13, … :53, never on a District minute", () => {
  const minutes = minutesOf("ScanBmsAlerts");
  expect(minutes).toEqual([3, 13, 23, 33, 43, 53]);
  expect(minutes.every((minute) => minute % 2 === 1)).toBe(true);
});

test("BmsVenueRequests runs at :08, :23, :38 and :53", () => {
  expect(minutesOf("BmsVenueRequests")).toEqual([8, 23, 38, 53]);
});

describe("WORKER_ROLE", () => {
  const { resolveRole } = require("../../workers/scheduler");

  const jobsFor = (role) => {
    cron.schedule.mockClear();
    const names = [];
    logger.info.mockImplementation((tag, message) => {
      const match = /•\s+(\S+)/.exec(message || "");
      if (match) names.push(match[1]);
    });
    startScheduler({ role });
    return names;
  };

  test("defaults to every job", () => {
    expect(resolveRole(undefined)).toBe("all");
    expect(jobsFor(undefined)).toEqual(expect.arrayContaining(["ScanAlerts", "ScanBmsAlerts", "RetryNotifications"]));
  });

  test("district runs no BookMyShow job", () => {
    const jobs = jobsFor("district");
    expect(jobs).toContain("ScanAlerts");
    expect(jobs).toContain("RetryNotifications");
    expect(jobs.filter((name) => /Bms/.test(name))).toEqual([]);
  });

  test("bookmyshow runs only the BookMyShow jobs", () => {
    expect(jobsFor("bookmyshow").sort()).toEqual(["BmsVenueRequests", "ScanBmsAlerts", "SyncBmsVenues"]);
  });

  test("district + bookmyshow together cover exactly what one 'all' worker runs", () => {
    const split = [...jobsFor("district"), ...jobsFor("bookmyshow")].sort();
    expect(split).toEqual(jobsFor("all").sort());
  });

  test("rejects an unknown role", () => {
    expect(() => resolveRole("bms")).toThrow(/WORKER_ROLE/);
  });
});
