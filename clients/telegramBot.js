const axios = require("axios");
const FormData = require("form-data");
const logger = require("../utils/logger");
const { BOT_COMMANDS } = require("../constants/appConstants");

const TAG = "TelegramBot";

const BASE_URL = "https://api.telegram.org";
let botToken = null;

function initBot({ registerCommands = true } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === "your_bot_token_here") {
    logger.warn(TAG, "TELEGRAM_BOT_TOKEN not configured, Telegram bot disabled");
    return null;
  }

  botToken = token;
  logger.info(TAG, "Telegram bot initialised (stateless HTTP mode)");

  if (registerCommands) setMyCommands();

  return true;
}

async function apiCall(method, params = {}) {
  if (!botToken) {
    logger.warn(TAG, "Bot not initialised, cannot call Telegram API");
    return null;
  }

  const url = `${BASE_URL}/bot${botToken}/${method}`;
  let res;
  try {
    res = await axios.post(url, params, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
  } catch (err) {
    const description = err.response?.data?.description;
    throw new Error(description ? `Telegram API error: ${description}` : err.message);
  }

  if (!res.data?.ok) {
    throw new Error(`Telegram API error: ${res.data?.description || "Unknown error"}`);
  }

  return res.data.result;
}

function isParseError(err) {
  return /can't parse entities|can't find end of the entity/i.test(err?.message || "");
}

function toPlainText(text) {
  return String(text || "")
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, "$1: $2")
    .replace(/\\([_*`[])/g, "$1")
    .replace(/[*`]/g, "");
}

async function withMarkdownFallback(method, params) {
  try {
    return await apiCall(method, params);
  } catch (err) {
    if (!params.parse_mode || !isParseError(err)) throw err;
    logger.warn(TAG, `${method}: Markdown rejected, resending as plain text`, err.message);
    const plain = { ...params, parse_mode: undefined };
    if (plain.text != null) plain.text = toPlainText(plain.text);
    if (plain.caption != null) plain.caption = toPlainText(plain.caption);
    return apiCall(method, plain);
  }
}

async function sendMessage(chatId, text, options = {}) {
  try {
    return await withMarkdownFallback("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: options.parse_mode === null ? undefined : options.parse_mode || "Markdown",
      reply_markup: options.reply_markup || undefined,
      disable_web_page_preview: options.disable_web_page_preview,
    });
  } catch (err) {
    logger.error(TAG, `Failed to send message to ${chatId}`, err.message);
    throw err;
  }
}

async function editMessageText(text, options = {}) {
  try {
    return await withMarkdownFallback("editMessageText", {
      chat_id: options.chat_id,
      message_id: options.message_id,
      text,
      parse_mode: options.parse_mode || "Markdown",
      reply_markup: options.reply_markup || undefined,
    });
  } catch (err) {
    if (err.message?.includes("message is not modified")) return null;
    logger.error(TAG, `Failed to edit message`, err.message);
    throw err;
  }
}

async function answerCallbackQuery(queryId, text = "") {
  try {
    return await apiCall("answerCallbackQuery", {
      callback_query_id: queryId,
      text: text || undefined,
    });
  } catch (err) {
    logger.error(TAG, `Failed to answer callback query`, err.message);
  }
}

async function sendPhoto(chatId, photo, options = {}) {
  if (!botToken) {
    logger.warn(TAG, "Bot not initialised, cannot call Telegram API");
    return null;
  }

  if (Buffer.isBuffer(photo)) {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("photo", photo, { filename: "image.png" });
    if (options.caption) form.append("caption", options.caption);
    if (options.parse_mode) form.append("parse_mode", options.parse_mode);
    if (options.reply_markup) form.append("reply_markup", JSON.stringify(options.reply_markup));

    const url = `${BASE_URL}/bot${botToken}/sendPhoto`;
    try {
      const res = await axios.post(url, form, {
        headers: form.getHeaders(),
        timeout: 10000,
      });

      if (!res.data?.ok) {
        throw new Error(`Telegram API error: ${res.data?.description || "Unknown error"}`);
      }
      return res.data.result;
    } catch (err) {
      const description = err.response?.data?.description;
      const message = description ? `Telegram API error: ${description}` : err.message;
      logger.error(TAG, `Failed to send photo buffer to ${chatId}`, message);
      if (options.parse_mode && isParseError({ message })) {
        return sendPhoto(chatId, photo, { ...options, parse_mode: undefined, caption: toPlainText(options.caption) });
      }
      throw new Error(message);
    }
  }

  try {
    return await withMarkdownFallback("sendPhoto", {
      chat_id: chatId,
      photo,
      caption: options.caption,
      parse_mode: options.parse_mode || "Markdown",
      reply_markup: options.reply_markup || undefined,
    });
  } catch (err) {
    logger.error(TAG, `Failed to send photo to ${chatId}`, err.message);
    throw err;
  }
}

async function setMyCommands(commands = BOT_COMMANDS) {
  try {
    const result = await apiCall("setMyCommands", { commands });
    if (result !== null) {
      logger.info(TAG, `Registered ${commands.length} bot commands`);
    }
    return result;
  } catch (err) {
    logger.error(TAG, "Failed to register bot commands", err.message);
    return null;
  }
}

async function deleteMessage(chatId, messageId) {
  try {
    return await apiCall("deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
  } catch (err) {
    logger.error(TAG, `Failed to delete message in ${chatId}`, err.message);
    throw err;
  }
}

module.exports = {
  toPlainText,
  deleteMessage,
  initBot,
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  sendPhoto,
  setMyCommands,
};
