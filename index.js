require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const passport = require("passport");

const connectDB = require("./config/db");
const { corsOptions } = require("./config/cors");
require("./config/passport");

const logger = require("./utils/logger");
const { sendSuccess, sendError, GENERIC_ERROR_MESSAGE } = require("./utils/response");
const { apiLimiter } = require("./middleware/rateLimit");

const authRoutes     = require("./routes/auth");
const userRoutes     = require("./routes/users");
const cityRoutes     = require("./routes/cities");
const movieRoutes    = require("./routes/movies");
const alertRoutes    = require("./routes/alerts");
const telegramRoutes = require("./routes/telegram");

const TAG = "API";
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.JWT_SECRET) {
  logger.error(TAG, "JWT_SECRET is not set, sign-in will not work");
}
if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
  logger.warn(
    TAG,
    isProduction
      ? "TELEGRAM_WEBHOOK_SECRET is not set, Telegram webhook calls will be REJECTED in production"
      : "TELEGRAM_WEBHOOK_SECRET is not set, the Telegram webhook accepts unauthenticated calls (dev only)"
  );
}

connectDB().catch(() => {
});

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
app.use(cors(corsOptions()));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(passport.initialize());

app.get("/", (req, res) => {
  sendSuccess(res, null, "API is running");
});

app.get("/health", (req, res) => {
  res.set("Cache-Control", "no-store");
  sendSuccess(res, { uptime: Math.round(process.uptime()) }, "ok");
});

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch {
    sendError(res, "We're having trouble right now. Please try again in a minute.", 503);
  }
});

app.use("/auth",         apiLimiter, authRoutes);
app.use("/api/user",     apiLimiter, userRoutes);
app.use("/api/cities",   apiLimiter, cityRoutes);
app.use("/api/movies",   apiLimiter, movieRoutes);
app.use("/api/alerts",   apiLimiter, alertRoutes);
app.use("/api/telegram", telegramRoutes);

const { initBot } = require("./clients/telegramBot");
initBot({ registerCommands: false });

app.use((req, res) => {
  sendError(res, "Not found", 404);
});

app.use((err, req, res, next) => {
  if (err?.type === "entity.parse.failed") return sendError(res, "The request body is not valid JSON.", 400);
  if (err?.type === "entity.too.large") return sendError(res, "The request is too large.", 413);
  logger.error(TAG, `Unhandled error on ${req.method} ${req.path}`, err?.stack || err?.message);
  sendError(res, GENERIC_ERROR_MESSAGE, 500);
});

if (require.main === module && !process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    logger.info(TAG, `API running on port ${PORT}`);
  });
}

module.exports = app;
