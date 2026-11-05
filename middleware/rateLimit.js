const { rateLimit } = require("express-rate-limit");
const { sendError } = require("../utils/response");
const { createRateLimitStore } = require("./rateLimitStore");

const MINUTE = 60 * 1000;

function limiter({ name, windowMs, limit, message, perUser = false }) {
  const options = {
    windowMs,
    limit,
    store: createRateLimitStore(name),
    passOnStoreError: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req, res) => sendError(res, message, 429, "RATE_LIMITED"),
    skip: () => process.env.NODE_ENV === "test" && !process.env.RATE_LIMIT_IN_TESTS,
  };
  if (perUser) options.keyGenerator = (req) => (req.user?.email ? `user:${req.user.email}` : req.ip);
  return rateLimit(options);
}

const apiLimiter = limiter({
  name: "general",
  windowMs: 15 * MINUTE,
  limit: 600,
  message: "You're going a little fast. Please wait a moment and try again.",
});

const movieSearchLimiter = limiter({
  name: "movie-search",
  windowMs: 10 * MINUTE,
  limit: 10,
  perUser: true,
  message: "You've searched a lot just now. Please wait a few minutes and try again.",
});

const venueRefreshLimiter = limiter({
  name: "venue-refresh",
  windowMs: 60 * MINUTE,
  limit: 5,
  perUser: true,
  message: "The theatre list was refreshed a few times already. Please try again later.",
});

const alertCreateLimiter = limiter({
  name: "alert-create",
  windowMs: 60 * MINUTE,
  limit: 30,
  perUser: true,
  message: "You've created a lot of alerts in the last hour. Please try again later.",
});

const telegramVerifyLimiter = limiter({
  name: "telegram-verify",
  windowMs: 15 * MINUTE,
  limit: 10,
  perUser: true,
  message: "Too many attempts. Please wait a few minutes and try again.",
});

const locationLimiter = limiter({
  name: "location",
  windowMs: 10 * MINUTE,
  limit: 10,
  perUser: true,
  message: "Please wait a moment before detecting your location again.",
});

module.exports = {
  apiLimiter,
  movieSearchLimiter,
  venueRefreshLimiter,
  alertCreateLimiter,
  telegramVerifyLimiter,
  locationLimiter,
};
