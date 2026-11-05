const cron = require("node-cron");
const logger = require("../utils/logger");

const syncCities = require("../services/syncCities");
const syncMovies = require("../services/syncMovies");
const syncVenues = require("../services/syncVenues");
const syncBmsVenues = require("../services/bmsVenues");
const scanAlerts = require("../services/scanAlerts");
const scanBmsAlerts = require("../services/scanBmsAlerts");
const retryNotifications = require("../services/retryNotifications");
const cleanupTelegramConnections = require("../services/cleanupTelegramConnections");
const { processDistrictSyncRequests, processBmsSyncRequests } = require("../services/citySyncRequests");
const Alert = require("../models/Alert");

const TAG = "Scheduler";
const TIMEZONE = "Asia/Kolkata";

function schedule(name, expression, job) {
  let running = false;
  cron.schedule(expression, async () => {
    if (running) {
      logger.warn(TAG, `${name} still running from the previous cycle, skipping`);
      return;
    }
    running = true;
    try {
      await job();
    } catch (err) {
      logger.error(TAG, `${name} failed`, err.message);
    } finally {
      running = false;
    }
  }, { timezone: TIMEZONE });
  logger.info(TAG, `  • ${name.padEnd(28)} ${expression}`);
}

async function expireOldAlerts() {
  const result = await Alert.updateMany(
    { status: "ACTIVE", expires_at: { $lte: new Date() } },
    { $set: { status: "EXPIRED" } }
  );
  logger.info(TAG, `Expired ${result.modifiedCount} old alerts`);
}

const ROLES = ["all", "district", "bookmyshow"];

function resolveRole(role = process.env.WORKER_ROLE) {
  const value = String(role || "all").trim().toLowerCase();
  if (!ROLES.includes(value)) throw new Error(`WORKER_ROLE must be one of ${ROLES.join(", ")} (got "${role}")`);
  return value;
}

function startScheduler({ role } = {}) {
  const workerRole = resolveRole(role);
  const district = workerRole !== "bookmyshow";
  const bookmyshow = workerRole !== "district";
  logger.info(TAG, `Registering cron jobs (IST), role "${workerRole}":`);

  if (district) {
    schedule("SyncCities", "0 2 * * 0", syncCities);
    schedule("SyncVenues", "0 3 * * 0", syncVenues);
    schedule("SyncMovies", "0 */4 * * *", syncMovies);
    schedule("ScanAlerts", "*/2 * * * *", scanAlerts);
    schedule("CitySyncRequests", "* * * * *", processDistrictSyncRequests);
    schedule("RetryNotifications", "* * * * *", retryNotifications);
    schedule("ExpireOldAlerts", "5 0 * * *", expireOldAlerts);
    schedule("CleanupTelegramConnections", "*/10 * * * *", cleanupTelegramConnections);
  }
  if (bookmyshow) {
    schedule("SyncBmsVenues", "0 5 * * 0", syncBmsVenues);
    schedule("ScanBmsAlerts", "3,13,23,33,43,53 * * * *", scanBmsAlerts);
    schedule("BmsVenueRequests", "8,23,38,53 * * * *", processBmsSyncRequests);
  }
  return workerRole;
}

module.exports = { startScheduler, resolveRole };
