const crypto = require("crypto");
const telegramConversationService = require("../services/telegramConversationService");
const logger = require("../utils/logger");

const TAG = "TelegramController";

const isFromTelegram = (req) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";

  const received = req.get("X-Telegram-Bot-Api-Secret-Token") || "";
  const expected = Buffer.from(secret);
  const actual = Buffer.from(received);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

const handleWebhook = async (req, res) => {
  if (!isFromTelegram(req)) {
    logger.warn(TAG, "Rejected webhook call with a missing or wrong secret token");
    return res.sendStatus(401);
  }

  const update = req.body || {};
  try {
    if (update.callback_query) {
      await telegramConversationService.handleCallbackQuery(update.callback_query);
    } else if (update.message) {
      await telegramConversationService.handleMessage(update.message);
    }
  } catch (error) {
    logger.error(TAG, "Error processing Telegram update", error.message);
  }

  res.sendStatus(200);
};

const handleMessage = async (message) => {
  return telegramConversationService.handleMessage(message);
};

const handleCallbackQuery = async (query) => {
  return telegramConversationService.handleCallbackQuery(query);
};

module.exports = {
  handleWebhook,
  handleMessage,
  handleCallbackQuery,
};
