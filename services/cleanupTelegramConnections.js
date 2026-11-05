const TelegramConnection = require("../models/TelegramConnection");
const logger = require("../utils/logger");

const TAG = "CleanupTelegramConnections";

async function cleanupTelegramConnections() {
  try {
    const now = new Date();
    const result = await TelegramConnection.deleteMany({
      $or: [
        { status: "COMPLETED" },
        { expires_at: { $lte: now } }
      ]
    });
    if (result.deletedCount > 0) logger.info(TAG, `Cleaned up ${result.deletedCount} TelegramConnection records.`);
    else logger.debug(TAG, "No TelegramConnection records to clean up");
    return { success: true, deletedCount: result.deletedCount };
  } catch (error) {
    logger.error(TAG, "Failed to clean up TelegramConnection records", error.message);
    return { success: false, error: error.message };
  }
}

module.exports = cleanupTelegramConnections;
