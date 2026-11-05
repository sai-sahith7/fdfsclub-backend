const pLimit = require("p-limit");
const Alert = require("../models/Alert");
const City = require("../models/City");
const Movie = require("../models/Movie");
const districtClient = require("../clients/districtClient");
const matchAlert = require("./matchAlert");
const { sendNotification } = require("./notificationSender");
const logger = require("../utils/logger");
const { toIsoDate, parseIsoDate } = require("../utils/dateOptions");
const { BATCH_CONCURRENCY, MAX_CONSECUTIVE_FAILURES } = require("../constants/appConstants");

const TAG = "ScanAlerts";

const failureCounters = new Map();

async function scanAlerts() {
  const cycleStart = Date.now();
  logger.info(TAG, "Starting alert scan cycle...");

  const now = new Date();
  const today = parseIsoDate(toIsoDate(now));

  const activeAlerts = await Alert.find({
    status: "ACTIVE",
    expires_at: { $gt: now },
    alert_date: { $gte: today },
  });

  if (activeAlerts.length === 0) {
    logger.info(TAG, "No active alerts to scan");
    await expireStaleAlerts();
    return { success: true, scanned: 0 };
  }

  logger.info(TAG, `Found ${activeAlerts.length} active alerts`);

  const scanBatches = new Map();

  for (const alert of activeAlerts) {
    const alertDate = alert.alert_date.toISOString().split("T")[0];
    const key = `${alert.movie.id}:${alert.city.name}:${alertDate}`;
    if (!scanBatches.has(key)) {
      scanBatches.set(key, []);
    }
    scanBatches.get(key).push(alert);
  }

  logger.info(TAG, `Grouped into ${scanBatches.size} scan batches`);

  const limit = pLimit(BATCH_CONCURRENCY);
  const batchPromises = [];

  for (const [key, alerts] of scanBatches.entries()) {
    batchPromises.push(limit(() => processBatch(key, alerts)));
  }

  const results = await Promise.allSettled(batchPromises);

  let totalMatches = 0;
  let totalErrors = 0;
  for (const result of results) {
    if (result.status === "fulfilled") {
      totalMatches += result.value.matches;
    } else {
      totalErrors++;
    }
  }

  await expireStaleAlerts();

  const elapsed = Date.now() - cycleStart;
  logger.info(
    TAG,
    `Scan cycle complete in ${elapsed}ms: ${activeAlerts.length} alerts, ${scanBatches.size} batches, ${totalMatches} matches, ${totalErrors} errors`
  );

  return {
    success: true,
    scanned: activeAlerts.length,
    batches: scanBatches.size,
    matches: totalMatches,
    errors: totalErrors,
    elapsedMs: elapsed,
  };
}

async function processBatch(batchKey, alerts) {
  const [movieIdStr, cityName, alertDate] = batchKey.split(":");
  const movieId = Number(movieIdStr);

  let matches = 0;

  const [movie, city] = await Promise.all([
    Movie.findOne({ contentId: movieId }),
    City.findOne({ name: cityName }),
  ]);

  if (!movie || !city) {
    logger.warn(TAG, `Batch ${batchKey}: movie or city not found in DB, skipping`);
    return { matches: 0 };
  }

  if (city.latitude == null || city.longitude == null) {
    logger.warn(TAG, `Batch ${batchKey}: city ${cityName} has no lat/lng, skipping`);
    return { matches: 0 };
  }

  const movieCodeToLang = {};
  if (movie.language_format_map) {
    for (const [code, lang] of movie.language_format_map) {
      movieCodeToLang[code] = lang;
    }
  }

  const needsDistrict = alerts.some(
    (alert) => !alert.venues || alert.venues.length === 0 || alert.venues.some((venue) => venue.source !== "bookmyshow")
  );
  if (!needsDistrict) return { matches: 0 };

  let cinemas = [];
  try {
    const result = await districtClient.getShowtimes({
      contentId: movieId,
      cityName: city.name,
      date: alertDate,
      lat: city.latitude,
      lng: city.longitude,
      movieCodeToLang,
    });
    cinemas = result.cinemas;

    failureCounters.delete(batchKey);
  } catch (error) {
    const count = (failureCounters.get(batchKey) || 0) + 1;
    failureCounters.set(batchKey, count);

    logger.error(
      TAG,
      `Batch ${batchKey}: API call failed (attempt ${count})`,
      error.message
    );

    if (count >= MAX_CONSECUTIVE_FAILURES) {
      logger.error(
        TAG,
        `Batch ${batchKey}: ${MAX_CONSECUTIVE_FAILURES} consecutive failures, requires attention`
      );
    }
    return { matches: 0 };
  }

  const alertIdsInBatch = [];

  for (const alert of alerts) {
    alertIdsInBatch.push(alert._id);

    const foundMatches = matchAlert(alert, cinemas);
    if (foundMatches.length > 0) {
      matches += foundMatches.length;
      logger.info(
        TAG,
        `Found ${foundMatches.length} match(es) for alert ${alert._id}`
      );

      try {
        await sendNotification(alert, foundMatches);
      } catch (error) {
        logger.error(TAG, `Failed to send notification for alert ${alert._id}`, error.message);
      }
    }
  }

  try {
    await Alert.updateMany(
      { _id: { $in: alertIdsInBatch }, status: "ACTIVE" },
      { $set: { last_checked_at: new Date() } }
    );
  } catch (error) {
    logger.error(TAG, `Failed to update last_checked_at for batch ${batchKey}`, error.message);
  }

  return { matches };
}

async function expireStaleAlerts() {
  try {
    const result = await Alert.updateMany(
      { status: "ACTIVE", expires_at: { $lte: new Date() } },
      { $set: { status: "EXPIRED" } }
    );
    if (result.modifiedCount > 0) {
      logger.info(TAG, `Expired ${result.modifiedCount} stale alerts`);
    }
  } catch (error) {
    logger.error(TAG, "Failed to expire stale alerts", error.message);
  }
}

module.exports = scanAlerts;
