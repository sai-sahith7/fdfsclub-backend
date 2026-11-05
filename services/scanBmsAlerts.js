const Alert = require("../models/Alert");
const City = require("../models/City");
const Venue = require("../models/Venue");
const bmsClient = require("../clients/bmsClient");
const { BmsBlockedError } = require("../clients/bmsClient");
const { venueShowtimes, toCinema, isCached } = require("./bmsShowtimes");
const matchAlert = require("./matchAlert");
const { sendNotification } = require("./notificationSender");
const { toIsoDate, parseIsoDate } = require("../utils/dateOptions");
const logger = require("../utils/logger");

const TAG = "ScanBmsAlerts";

const envInt = (name, fallback) => {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const BMS_SCAN_BUDGET = envInt("BMS_SCAN_BUDGET", 40);
const PICKED_SHARE = 0.7;

const lastFetchedAt = new Map();

function buildWorkItems(alerts, citiesByName, venuesByCity) {
  const items = new Map();

  for (const alert of alerts) {
    const city = citiesByName.get(alert.city.name);
    const cityVenues = city ? venuesByCity.get(city.name) : null;
    if (!cityVenues || cityVenues.length === 0) continue;

    const date = alert.alert_date.toISOString().slice(0, 10);
    const picked = alert.venues || [];
    const anyVenue = picked.length === 0;
    const pickedIds = new Set(picked.map((venue) => venue.id));
    const targets = anyVenue ? cityVenues : cityVenues.filter((venue) => pickedIds.has(venue._id));

    for (const venue of targets) {
      const key = `${venue._id}:${date}`;
      let item = items.get(key);
      if (!item) {
        item = { key, venue, city, date, tier: 1, alerts: [] };
        items.set(key, item);
      }
      if (!anyVenue) item.tier = 0;
      item.alerts.push(alert);
    }
  }
  return [...items.values()];
}

function byPriority(a, b) {
  return (
    (lastFetchedAt.get(a.key) || 0) - (lastFetchedAt.get(b.key) || 0) ||
    a.date.localeCompare(b.date) ||
    b.alerts.length - a.alerts.length
  );
}

function selectWithinBudget(items, budget) {
  const free = items.filter((item) => isCached(item.venue.bms_venue_code, item.city.bms_region.code, item.date.replace(/-/g, "")));
  const paid = items.filter((item) => !free.includes(item));
  const picked = paid.filter((item) => item.tier === 0).sort(byPriority);
  const anyVenue = paid.filter((item) => item.tier === 1).sort(byPriority);

  const pickedTake = picked.slice(0, Math.min(picked.length, Math.ceil(budget * PICKED_SHARE)));
  const anyTake = anyVenue.slice(0, budget - pickedTake.length);
  const spill = picked.slice(pickedTake.length, pickedTake.length + (budget - pickedTake.length - anyTake.length));

  return { selected: [...free, ...pickedTake, ...spill, ...anyTake], deferred: paid.length - pickedTake.length - spill.length - anyTake.length };
}

async function scanBmsAlerts({ client = bmsClient, budget = BMS_SCAN_BUDGET, now = new Date() } = {}) {
  const cycleStart = Date.now();

  if (client.isPaused && client.isPaused()) {
    logger.info(TAG, "BookMyShow is paused after a block or rate limit, skipping this cycle");
    return { success: true, skipped: "paused", requests: 0, matches: 0 };
  }

  const today = parseIsoDate(toIsoDate(now));
  const alerts = await Alert.find({ status: "ACTIVE", expires_at: { $gt: now }, alert_date: { $gte: today } }).lean();
  if (alerts.length === 0) {
    logger.debug(TAG, "No active alerts");
    return { success: true, requests: 0, matches: 0 };
  }

  const cityNames = [...new Set(alerts.map((alert) => alert.city.name))];
  const cities = await City.find({ name: { $in: cityNames }, "bms_region.code": { $ne: null }, "bms_region.slug": { $ne: null } }).lean();
  if (cities.length === 0) return { success: true, requests: 0, matches: 0 };

  const venues = await Venue.find({ city_name: { $in: cities.map((city) => city.name) }, source: "bookmyshow" }).lean();
  const venuesByCity = new Map();
  for (const venue of venues) {
    if (!venuesByCity.has(venue.city_name)) venuesByCity.set(venue.city_name, []);
    venuesByCity.get(venue.city_name).push(venue);
  }

  const items = buildWorkItems(alerts, new Map(cities.map((city) => [city.name, city])), venuesByCity);
  if (items.length === 0) {
    logger.debug(TAG, "No alerts can match a BookMyShow-only theatre");
    return { success: true, requests: 0, matches: 0 };
  }

  const { selected, deferred } = selectWithinBudget(items, budget);
  const cinemasByAlert = new Map();
  const checkedAlertIds = new Set();
  let requests = 0;
  let stoppedBy = null;

  for (const item of selected) {
    const dateCode = item.date.replace(/-/g, "");
    const region = item.city.bms_region;
    const wasCached = isCached(item.venue.bms_venue_code, region.code, dateCode);

    let showtimes;
    try {
      showtimes = await venueShowtimes(item.venue.bms_venue_code, region.code, dateCode, client);
    } catch (error) {
      if (!wasCached) requests++;
      if (error instanceof BmsBlockedError) {
        stoppedBy = error.message;
        break;
      }
      logger.warn(TAG, `No showtimes for ${item.venue.name} on ${item.date}`, error.message);
      lastFetchedAt.set(item.key, Date.now());
      continue;
    }
    if (!wasCached) requests++;
    lastFetchedAt.set(item.key, Date.now());

    for (const alert of item.alerts) {
      checkedAlertIds.add(alert._id);
      const cinema = toCinema({ venue: item.venue, region, dateCode, movie: alert.movie, showtimes });
      if (!cinema) continue;
      if (!cinemasByAlert.has(alert._id)) cinemasByAlert.set(alert._id, { alert, cinemas: [] });
      cinemasByAlert.get(alert._id).cinemas.push(cinema);
    }
  }

  let matches = 0;
  for (const { alert, cinemas } of cinemasByAlert.values()) {
    const found = matchAlert(alert, cinemas);
    if (found.length === 0) continue;
    matches += found.length;
    try {
      await sendNotification(alert, found);
    } catch (error) {
      logger.error(TAG, `Failed to notify alert ${alert._id}`, error.message);
    }
  }

  if (checkedAlertIds.size > 0) {
    await Alert.updateMany(
      { _id: { $in: [...checkedAlertIds] }, status: "ACTIVE" },
      { $set: { last_checked_at: new Date() } }
    ).catch((error) => logger.error(TAG, "Failed to update last_checked_at", error.message));
  }

  const usage = client.usage ? client.usage() : null;
  logger.info(
    TAG,
    `BookMyShow cycle in ${Date.now() - cycleStart}ms: ${requests}/${budget} requests, ` +
      `${selected.length}/${items.length} theatre-days checked, ${deferred} deferred, ${matches} matches` +
      (usage ? `, today ${usage.sentToday}/${usage.dailyCap}` : "") +
      (stoppedBy ? `, stopped: ${stoppedBy}` : "")
  );

  return { success: true, requests, items: items.length, checked: selected.length, deferred, matches, stoppedBy };
}

function resetScanState() {
  lastFetchedAt.clear();
}

module.exports = scanBmsAlerts;
module.exports.selectWithinBudget = selectWithinBudget;
module.exports.buildWorkItems = buildWorkItems;
module.exports.resetScanState = resetScanState;
module.exports.BMS_SCAN_BUDGET = BMS_SCAN_BUDGET;
