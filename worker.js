require("dotenv").config();

const connectDB = require("./config/db");
const { startScheduler, resolveRole } = require("./workers/scheduler");
const { initBot } = require("./clients/telegramBot");
const logger = require("./utils/logger");

const TAG = "Worker";

async function main() {
  logger.info(TAG, "Worker starting...");

  const role = resolveRole();

  await connectDB();

  initBot({ registerCommands: role !== "bookmyshow" });

  startScheduler({ role });

  logger.info(TAG, "Worker is running. Press Ctrl+C to stop.");

  const shutdown = (signal) => {
    logger.info(TAG, `Received ${signal}, shutting down...`);
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error(TAG, "Worker failed to start", err.message);
  process.exit(1);
});
