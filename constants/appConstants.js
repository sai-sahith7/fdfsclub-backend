const APP_NAME = (process.env.APP_NAME || "FDFSClub").trim();

const FAMOUS_CITIES = [
  "bengaluru", "mumbai", "new-delhi", "hyderabad",
  "chennai", "kolkata", "pune", "ahmedabad",
];

const LANGUAGE_FILTER_OPTIONS = ["Any", "English", "Hindi", "Telugu", "Tamil", "Kannada", "Malayalam"];
const FORMAT_FILTER_OPTIONS = ["Any", "IMAX", "3D", "2D", "4DX"];
const PRICE_FILTER_OPTIONS = ["Any", "200", "300", "500", "1000", "2000"];

const BATCH_CONCURRENCY = 5;
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_RETRIES = 3;

const CONVERSATION_TTL_MS = 30 * 60 * 1000;

const BOT_COMMANDS = [
  { command: "start", description: `Link Telegram to your ${APP_NAME} account` },
  { command: "new", description: "Create a new ticket alert" },
  { command: "search", description: "Search for a movie" },
  { command: "alerts", description: "See your active alerts" },
  { command: "unlink", description: "Stop alerts on Telegram" },
  { command: "help", description: "See what I can do" },
];

const MAX_ACTIVE_ALERTS_PER_USER = 3;
const MAX_VENUES_PER_ALERT = 50;
const MAX_ALERT_DAYS_AHEAD = 180;

const TELEGRAM_CODE_TTL_MINUTES = 15;

module.exports = {
  APP_NAME,
  MAX_ACTIVE_ALERTS_PER_USER,
  MAX_VENUES_PER_ALERT,
  MAX_ALERT_DAYS_AHEAD,
  FAMOUS_CITIES,
  LANGUAGE_FILTER_OPTIONS,
  FORMAT_FILTER_OPTIONS,
  PRICE_FILTER_OPTIONS,
  BATCH_CONCURRENCY,
  MAX_CONSECUTIVE_FAILURES,
  MAX_RETRIES,
  CONVERSATION_TTL_MS,
  BOT_COMMANDS,
  TELEGRAM_CODE_TTL_MINUTES,
};
