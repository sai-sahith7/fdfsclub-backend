const crypto = require("crypto");

const STATE_COOKIE = "oauth_state";
const STATE_COOKIE_PATH = "/auth/google";
const STATE_TTL_MS = 10 * 60 * 1000;

function readCookie(req, name) {
  const header = req.headers?.cookie || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: STATE_COOKIE_PATH,
  };
}

function statesMatch(expected, provided) {
  if (typeof expected !== "string" || typeof provided !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

class CookieStateStore {
  store(req, state, meta, callback) {
    const handle = crypto.randomBytes(24).toString("base64url");
    req.res.cookie(STATE_COOKIE, handle, { ...cookieOptions(), maxAge: STATE_TTL_MS });
    callback(null, handle);
  }

  verify(req, providedState, meta, callback) {
    const expected = readCookie(req, STATE_COOKIE);
    req.res.clearCookie(STATE_COOKIE, cookieOptions());
    if (!statesMatch(expected, providedState)) {
      return callback(null, false, { message: "Sign-in request expired or did not match." });
    }
    return callback(null, true);
  }
}

module.exports = { CookieStateStore, readCookie, STATE_COOKIE };
