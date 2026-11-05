const AlertNotification = require("../models/AlertNotification");
const Alert = require("../models/Alert");
const User = require("../models/User");
const { dispatchNotification } = require("./notificationSender");
const logger = require("../utils/logger");
const { MAX_RETRIES } = require("../constants/appConstants");

const TAG = "RetryNotifications";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STUCK_PENDING_MS = 10 * 60 * 1000;

async function markDead(notification) {
  await AlertNotification.updateOne({ _id: notification._id }, { $set: { status: "dead" } });
}

async function retryFailedNotifications() {
  const now = Date.now();
  const cutoff = new Date(now - MAX_AGE_MS);

  const candidates = await AlertNotification.find({
    created_at: { $gt: cutoff },
    retry_count: { $lt: MAX_RETRIES },
    $or: [
      { status: "failed" },
      { status: "pending", updated_at: { $lt: new Date(now - STUCK_PENDING_MS) } },
    ],
  });

  if (candidates.length === 0) {
    logger.debug(TAG, "No notifications to retry");
    return { success: true, retried: 0 };
  }

  logger.info(TAG, `Found ${candidates.length} notifications to retry`);

  let retried = 0;
  let succeeded = 0;
  let deadLettered = 0;

  for (const candidate of candidates) {
    const notification = await AlertNotification.findOneAndUpdate(
      { _id: candidate._id, status: candidate.status, retry_count: candidate.retry_count },
      { $inc: { retry_count: 1 }, $set: { status: "pending" } },
      { new: true }
    );
    if (!notification) continue;
    retried++;

    const alert = await Alert.findById(notification.alert_id);
    if (!alert) {
      logger.warn(TAG, `Alert ${notification.alert_id} not found, marking notification as dead`);
      await markDead(notification);
      deadLettered++;
      continue;
    }

    const user = await User.findOne({ email: alert.user_email });
    if (!user) {
      logger.warn(TAG, `User ${alert.user_email} not found, marking notification as dead`);
      await markDead(notification);
      deadLettered++;
      continue;
    }

    try {
      await dispatchNotification(notification, user, alert);

      await AlertNotification.updateOne(
        { _id: notification._id },
        { $set: { status: "sent", sent_at: new Date() } }
      );
      succeeded++;
      logger.info(TAG, `Retry succeeded for notification ${notification._id}`);
    } catch (error) {
      const exhausted = notification.retry_count >= MAX_RETRIES;
      if (exhausted) {
        deadLettered++;
        logger.error(TAG, `Notification ${notification._id} exhausted all ${MAX_RETRIES} retries, marked as dead`);
      }

      await AlertNotification.updateOne(
        { _id: notification._id },
        { $set: { status: exhausted ? "dead" : "failed" } }
      );

      logger.error(
        TAG,
        `Retry ${notification.retry_count}/${MAX_RETRIES} failed for notification ${notification._id}`,
        error.message
      );
    }
  }

  logger.info(
    TAG,
    `Retry cycle complete: ${retried} attempted, ${succeeded} succeeded, ${deadLettered} dead-lettered`
  );

  return { success: true, retried, succeeded, deadLettered };
}

module.exports = retryFailedNotifications;
