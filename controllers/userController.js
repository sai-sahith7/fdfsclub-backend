const User = require("../models/User");
const City = require("../models/City");
const TelegramConnection = require("../models/TelegramConnection");
const UserDTO = require("../dtos/user.dto");
const { sendSuccess, sendError, sendServerError, HttpError } = require("../utils/response");
const locationService = require("../services/locationService");
const telegramBot = require("../clients/telegramBot");
const { escapeMarkdown } = require("../utils/telegramMarkdown");
const logger = require("../utils/logger");
const { APP_NAME } = require("../constants/appConstants");

const TAG = "UserController";

const INVALID_CODE_MESSAGE = "That code didn't work. It may have expired, so send /start to the bot for a new one.";

const getProfile = async (req, res) => {
  try {
    const user = await User.findOne({ email: req.user.email });
    if (!user) return sendError(res, "We couldn't find your account. Please sign in again.", 404);
    sendSuccess(res, UserDTO.toResponse(user));
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

const resolveFavouriteCity = async (input) => {
  if (input === null || input === "") return { name: null, slug: null };

  const slug = typeof input === "string" ? input : input?.slug;
  const name = typeof input === "string" ? null : input?.name;

  if ((!slug || typeof slug !== "string") && (!name || typeof name !== "string")) {
    throw new HttpError(400, "Please pick a city from the list.");
  }

  const query = typeof slug === "string" && slug ? { slug } : { name };
  const city = await City.findOne(query);
  if (!city) {
    throw new HttpError(404, "We couldn't find that city. Please pick one from the list.");
  }

  return { name: city.name, slug: city.slug };
};

const updateProfile = async (req, res) => {
  try {
    const updates = {};
    if (req.body.name !== undefined) {
      const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
      if (!name) return sendError(res, "Please enter your name.", 400);
      if (name.length > 80) return sendError(res, "Please keep your name under 80 characters.", 400);
      updates.name = name;
    }

    if (req.body.favourite_city !== undefined) {
      updates.favourite_city = await resolveFavouriteCity(req.body.favourite_city);
    }

    const user = await User.findOneAndUpdate(
      { email: req.user.email },
      { $set: updates },
      { new: true }
    );

    if (!user) return sendError(res, "We couldn't find your account. Please sign in again.", 404);
    sendSuccess(res, UserDTO.toResponse(user), "Profile updated");
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

const resolveLocation = async (req, res) => {
  try {
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    if (
      req.body.lat == null || req.body.lng == null ||
      !Number.isFinite(lat) || !Number.isFinite(lng) ||
      Math.abs(lat) > 90 || Math.abs(lng) > 180
    ) {
      return sendError(res, "We couldn't read your location. Please pick your city from the list.", 400);
    }
    const result = await locationService.resolveUserLocation(lat, lng, req.user.email);
    sendSuccess(res, result.data, result.message);
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

const sendTelegramConnectedMessage = async (chatId, user) => {
  try {
    await telegramBot.sendMessage(
      chatId,
      `*You're connected!*\n\n` +
      `This chat is now linked to *${escapeMarkdown(user.email)}* on ${escapeMarkdown(APP_NAME)}.\n\n` +
      `I'll message you here when tickets open for any of your alerts.\n\n` +
      `Send /new to create an alert, or /help to see everything I can do.`
    );
  } catch (error) {
    logger.error(TAG, `Failed to send Telegram connection confirmation to ${chatId}`, error.message);
  }
};

const verifyTelegramCode = async (req, res) => {
  try {
    const code = typeof req.body.code === "string" ? req.body.code.trim() : "";

    if (!code) {
      return sendError(res, "Please enter the 6-digit code from Telegram.", 400);
    }
    if (!/^\d{6}$/.test(code)) {
      return sendError(res, INVALID_CODE_MESSAGE, 400);
    }

    const connection = await TelegramConnection.findOneAndUpdate(
      { code, status: "PENDING", expires_at: { $gt: new Date() } },
      { $set: { status: "COMPLETED" } },
      { new: true }
    );

    if (!connection) {
      return sendError(res, INVALID_CODE_MESSAGE, 400);
    }

    await User.updateMany(
      { "telegram.chat_id": String(connection.chat_id), "telegram.connected": true, email: { $ne: req.user.email } },
      { $set: { "telegram.chat_id": null, "telegram.username": null, "telegram.connected": false } }
    );

    const user = await User.findOneAndUpdate(
      { email: req.user.email },
      {
        $set: {
          "telegram.chat_id": String(connection.chat_id),
          "telegram.username": connection.telegram_handle,
          "telegram.connected": true,
        },
      },
      { new: true }
    );

    if (!user) {
      await TelegramConnection.updateOne({ _id: connection._id }, { $set: { status: "PENDING" } });
      return sendError(res, "We couldn't find your account. Please sign in again.", 404);
    }

    await sendTelegramConnectedMessage(connection.chat_id, user);

    sendSuccess(res, UserDTO.toResponse(user), "Telegram connected");
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

const disconnectTelegram = async (req, res) => {
  try {
    const user = await User.findOneAndUpdate(
      { email: req.user.email },
      {
        $set: {
          "telegram.chat_id": null,
          "telegram.username": null,
          "telegram.connected": false,
        },
      },
      { new: true }
    );

    if (!user) return sendError(res, "We couldn't find your account. Please sign in again.", 404);
    sendSuccess(res, UserDTO.toResponse(user), "Telegram disconnected");
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

module.exports = {
  getProfile,
  updateProfile,
  resolveLocation,
  verifyTelegramCode,
  disconnectTelegram,
  resolveFavouriteCity,
  sendTelegramConnectedMessage,
};
