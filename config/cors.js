const { getFrontendBaseUrl } = require("../utils/appLinks");

const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173"];

const normalise = (origin) => String(origin || "").trim().replace(/\/+$/, "").toLowerCase();

function getAllowedOrigins() {
  const origins = new Set([normalise(getFrontendBaseUrl())]);
  for (const origin of String(process.env.CORS_ORIGINS || "").split(",")) {
    if (origin.trim()) origins.add(normalise(origin));
  }
  if (process.env.NODE_ENV !== "production") DEV_ORIGINS.forEach((origin) => origins.add(origin));
  return origins;
}

function corsOptions() {
  const allowed = getAllowedOrigins();
  return {
    origin: (origin, callback) => callback(null, !origin || allowed.has(normalise(origin))),
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  };
}

module.exports = { corsOptions, getAllowedOrigins };
