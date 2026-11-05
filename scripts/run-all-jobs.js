require("dotenv").config();
const connectDB = require("../config/db");
const logger = require("../utils/logger");
const Alert = require("../models/Alert");
const { initBot } = require("../clients/telegramBot");

const syncCities = require("../services/syncCities");
const syncMovies = require("../services/syncMovies");
const syncVenues = require("../services/syncVenues");
const scanAlerts = require("../services/scanAlerts");
const scanBmsAlerts = require("../services/scanBmsAlerts");
const retryNotifications = require("../services/retryNotifications");
const cleanupTelegramConnections = require("../services/cleanupTelegramConnections");

const TAG = "RunAll";
const args = new Set(process.argv.slice(2));

async function step(name, job) {
  logger.info(TAG, `--- ${name} ---`);
  await job().catch((error) => logger.error(TAG, `${name} failed`, error.message));
}

async function runAll() {
  await connectDB();
  initBot({ registerCommands: false });

  if (args.has("--sync")) {
    await step("SyncCities", syncCities);
    await step("SyncVenues", syncVenues);
    await step("SyncMovies", syncMovies);
  }
  await step("ScanAlerts", scanAlerts);
  if (args.has("--bms")) await step("ScanBmsAlerts", scanBmsAlerts);
  await step("RetryNotifications", retryNotifications);
  await step("CleanupTelegramConnections", cleanupTelegramConnections);
  await step("ExpireOldAlerts", () =>
    Alert.updateMany({ status: "ACTIVE", expires_at: { $lte: new Date() } }, { $set: { status: "EXPIRED" } })
  );

  logger.info(TAG, "Done.");
  process.exit(0);
}

runAll().catch((error) => {
  logger.error(TAG, "Run failed", error.message);
  process.exit(1);
});
