const DEFAULT_FRONTEND_URL = "http://localhost:5173";

function getFrontendBaseUrl() {
  const configured = (process.env.FRONTEND_URL || "").trim();
  return (configured || DEFAULT_FRONTEND_URL).replace(/\/+$/, "");
}

function buildTelegramLinkUrl(code) {
  const base = `${getFrontendBaseUrl()}/telegram`;
  return code ? `${base}?code=${encodeURIComponent(code)}` : base;
}

module.exports = { getFrontendBaseUrl, buildTelegramLinkUrl, DEFAULT_FRONTEND_URL };
