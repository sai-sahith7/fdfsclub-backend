const crypto = require("crypto");
const logger = require("../utils/logger");

const BASE_URL = "https://in.bookmyshow.com";
const TAG = "bmsClient";

const envInt = (name, fallback) => {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const MIN_INTERVAL_MS = envInt("BMS_MIN_INTERVAL_MS", 3000);
const JITTER_MS = 1000;
const TIMEOUT_MS = 20000;
const BLOCK_COOLDOWN_MIN_MS = 2 * 60 * 1000;
const BLOCK_COOLDOWN_MAX_MS = 30 * 60 * 1000;
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const REGIONS_TTL_MS = 24 * 60 * 60 * 1000;
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
const DAILY_REQUEST_CAP = envInt("BMS_DAILY_REQUEST_CAP", 5000);
const PROXY_URL = process.env.BMS_PROXY_URL || undefined;

const CHALLENGE_MARKERS = [
  "just a moment", "cf-chl-", "cf-turnstile", "challenges.cloudflare.com",
  "sorry, you have been blocked", "verify you are human", "<title>access denied",
];

const STATUS_COLOR = { 3: "G", 2: "Y", 1: "R", 0: "R" };

class BmsBlockedError extends Error {}
class BmsBudgetError extends BmsBlockedError {}

function istDay(ms) {
  return new Date(ms + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function* walk(value) {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (Array.isArray(current)) pending.push(...current);
    else if (current && typeof current === "object") {
      yield current;
      pending.push(...Object.values(current));
    }
  }
}

function coordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) && number !== 0 && Math.abs(number) <= 180 ? number : null;
}

function istToUtc(code) {
  if (!/^\d{12}$/.test(String(code || ""))) return "";
  const c = String(code);
  const utc = new Date(`${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}T${c.slice(8, 10)}:${c.slice(10, 12)}:00+05:30`);
  return utc.toISOString().slice(0, 16);
}

function price(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseRobots(text) {
  const rules = [];
  let applies = false;
  let inAgents = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === "user-agent") {
      if (!inAgents) applies = false;
      inAgents = true;
      if (value === "*") applies = true;
      continue;
    }
    inAgents = false;
    if (applies && (field === "allow" || field === "disallow") && value) {
      const pattern = value.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
      rules.push({ allow: field === "allow", length: value.length, regex: new RegExp(`^${pattern}`) });
    }
  }
  return (path) => {
    let best = null;
    for (const rule of rules) {
      if (!rule.regex.test(path)) continue;
      if (!best || rule.length > best.length || (rule.length === best.length && rule.allow)) best = rule;
    }
    return !best || best.allow;
  };
}

class BmsClient {
  constructor({
    http = null,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => Date.now(),
    dailyCap = DAILY_REQUEST_CAP,
  } = {}) {
    this._http = http;
    this._dailyCap = dailyCap;
    this._day = null;
    this._sentToday = 0;
    this._sleep = sleep;
    this._now = now;
    this._queue = Promise.resolve();
    this._lastRequestAt = 0;
    this._pausedUntil = 0;
    this._denials = 0;
    this._robots = null;
    this._regions = null;
  }

  _client() {
    if (!this._http) {
      const { Impit } = require("impit");
      this._http = new Impit({ browser: "chrome", timeout: TIMEOUT_MS, proxyUrl: PROXY_URL });
    }
    return this._http;
  }

  _request(path, options = {}) {
    const task = this._queue.then(() => this._send(path, options));
    this._queue = task.catch(() => {});
    return task;
  }

  async _send(path, { headers = {}, robots = true, page = false, optional = false } = {}) {
    if (this._now() < this._pausedUntil) {
      throw new BmsBlockedError(`BookMyShow paused until ${new Date(this._pausedUntil).toISOString()}`);
    }
    if (robots) await this._checkRobots(path);
    this._spend();

    const wait = this._lastRequestAt + MIN_INTERVAL_MS + Math.random() * JITTER_MS - this._now();
    if (wait > 0) await this._sleep(wait);
    this._lastRequestAt = this._now();

    const requestHeaders = page
      ? headers
      : { Accept: "application/json, text/plain, */*", "Accept-Language": "en-IN,en;q=0.9", ...headers };
    const response = await this._client().fetch(BASE_URL + path, { headers: requestHeaders, redirect: "manual" });
    const body = await response.text();
    const lowered = body.slice(0, 5000).toLowerCase();
    const isHtml = /html/i.test(response.headers.get("content-type") || "") || lowered.trimStart().startsWith("<");
    const denied = response.status === 401 || response.status === 403 || (isHtml && CHALLENGE_MARKERS.some((m) => lowered.includes(m)));

    if (denied && optional) return { status: 403, headers: response.headers, body: "" };
    if (denied) {
      const cooldown = Math.min(BLOCK_COOLDOWN_MIN_MS * 2 ** this._denials, BLOCK_COOLDOWN_MAX_MS);
      this._denials++;
      this._pausedUntil = this._now() + cooldown;
      logger.error(TAG, `Access denied or challenge (HTTP ${response.status}) on ${path.split("?")[0]}, pausing BookMyShow for ${cooldown / 60000} min`);
      throw new BmsBlockedError(`BookMyShow denied access (HTTP ${response.status})`);
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after")) * 1000;
      this._pausedUntil = this._now() + Math.max(RATE_LIMIT_COOLDOWN_MS, retryAfter || 0);
      logger.warn(TAG, "Rate limited (HTTP 429), pausing BookMyShow");
      throw new BmsBlockedError("BookMyShow rate limited the client");
    }
    if (response.status < 400) this._denials = 0;
    return { status: response.status, headers: response.headers, body };
  }

  _spend() {
    const today = istDay(this._now());
    if (today !== this._day) {
      if (this._day) logger.info(TAG, `BookMyShow requests on ${this._day}: ${this._sentToday}/${this._dailyCap}`);
      this._day = today;
      this._sentToday = 0;
    }
    if (this._sentToday >= this._dailyCap) {
      throw new BmsBudgetError(`BookMyShow daily budget of ${this._dailyCap} requests is spent`);
    }
    this._sentToday++;
  }

  usage() {
    const today = istDay(this._now());
    return { sentToday: today === this._day ? this._sentToday : 0, dailyCap: this._dailyCap };
  }

  isPaused() {
    return this._now() < this._pausedUntil;
  }

  async _checkRobots(path) {
    if (!this._robots || this._now() > this._robots.expires) {
      const response = await this._send("/robots.txt", { robots: false, page: true, optional: true });
      const allowed = response.status === 200 ? parseRobots(response.body) : () => true;
      this._robots = { allowed, expires: this._now() + ROBOTS_TTL_MS };
    }
    if (!this._robots.allowed(path)) throw new Error(`robots.txt disallows ${path.split("?")[0]}`);
  }

  async _json(path, headers = {}, { optional = false } = {}) {
    const response = await this._request(path, { headers, optional });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`BookMyShow HTTP ${response.status} for ${path.split("?")[0]}`);
    }
    try {
      return JSON.parse(response.body);
    } catch {
      throw new Error(`BookMyShow returned non-JSON for ${path.split("?")[0]}`);
    }
  }

  _visitorId() {
    if (!this._bmsId) this._bmsId = `1.${Math.floor(Math.random() * 1e9)}.${this._now()}`;
    return this._bmsId;
  }

  async getRegions() {
    if (this._regions && this._now() < this._regions.expires) return this._regions.list;
    const payload = await this._json("/api/explore/v1/discover/regions", {}, { optional: true });
    const byCode = new Map();
    for (const item of walk(payload)) {
      const code = item.RegionCode || item.regionCode;
      const name = item.RegionName || item.regionName;
      if (!code || !name) continue;
      byCode.set(String(code), {
        code: String(code),
        name,
        slug: item.RegionSlug || item.regionSlug || null,
        aliases: Array.isArray(item.Alias) ? item.Alias : [],
        latitude: coordinate(item.Lat),
        longitude: coordinate(item.Long),
      });
    }
    if (byCode.size === 0) throw new Error("BookMyShow regions response had no regions");
    this._regions = { list: [...byCode.values()], expires: this._now() + REGIONS_TTL_MS };
    return this._regions.list;
  }

  async getCityMovies(regionSlug, regionCode) {
    const bmsId = this._visitorId();
    const query = new URLSearchParams({ embedded: "true", scrollId: crypto.randomUUID(), pageId: "1" });
    const payload = await this._json(`/api/explore/v1/discover/movies-${encodeURIComponent(regionSlug)}?${query}`, {
      "x-app-code": "WEB", "x-platform": "WEB", "x-platform-code": "DESKTOP-WEB",
      "x-region-code": regionCode, "x-region-slug": regionSlug, "x-bms-id": bmsId, cookie: `bmsId=${bmsId}`,
    });
    const movies = new Map();
    for (const card of walk(payload.listings || [])) {
      const match = String(card.ctaUrl || "").match(/\/movies\/[a-z0-9-]+\/([a-z0-9-]+)\/(ET\d+)/);
      if (!match) continue;
      movies.set(match[2], { eventCode: match[2], eventGroupCode: card.id || null, slug: match[1] });
    }
    return [...movies.values()];
  }

  async getVenuesForEvent(eventCode, regionCode, dateCode) {
    const query = new URLSearchParams({
      eventCode, dateCode, regionCode, isDesktop: "true", xLocationShared: "false", memberId: "", lsId: "", subCode: "",
    });
    const payload = await this._json(`/api/movies-data/v4/showtimes-by-event/primary-dynamic?${query}`, {
      "x-app-code": "WEB", "x-region-code": regionCode,
    });
    const venues = new Map();
    for (const node of walk(payload?.data?.showtimeWidgets || [])) {
      const info = node.additionalData;
      if (node.type === "venue-card" && info?.venueCode) venues.set(info.venueCode, { code: info.venueCode, name: info.venueName || info.venueCode });
    }
    return [...venues.values()];
  }

  async getVenueShowtimes(venueCode, regionCode, dateCode) {
    const query = new URLSearchParams({ venueCode, regionCode, dateCode, appCode: "WEB" });
    const payload = await this._json(`/api/v3/mobile/showtimes/byvenue?${query}`, {
      "x-app-code": "WEB", "x-region-code": regionCode,
    });
    const details = Array.isArray(payload?.ShowDetails) ? payload.ShowDetails : null;
    if (!details) throw new Error("BookMyShow byvenue response had no ShowDetails");

    let venue = null;
    const events = [];
    for (const detail of details) {
      const info = detail.Venues || {};
      if (!venue && info.VenueCode) {
        venue = {
          code: info.VenueCode,
          name: info.VenueName || info.VenueCode,
          address: info.VenueAdd || null,
          latitude: coordinate(info.VenueLat),
          longitude: coordinate(info.VenueLong),
          chain: info.VenueCompName || null,
          amenities: String(info.VenueLegends || "").split(";").filter(Boolean),
        };
      }
      for (const event of detail.Event || []) {
        const variants = [];
        for (const child of event.ChildEvents || []) {
          const shows = (child.ShowTimes || []).filter((show) => String(show.ShowDateCode) === dateCode && show.SessionId);
          if (shows.length) variants.push({ child, shows });
        }
        if (variants.length) events.push({ title: event.EventTitle || "", eventGroup: event.EventGroup || null, variants });
      }
    }
    return { venue, events };
  }
}

function toDistrictSessions(event, { cinemaId, bookingUrl }) {
  const sessions = [];
  for (const { child, shows } of event.variants) {
    for (const show of shows) {
      sessions.push({
        source: "bookmyshow",
        sessionId: String(show.SessionId),
        providerId: null,
        cinemaId,
        movieCode: child.EventCode || "",
        showTime: istToUtc(show.ShowDateTime),
        closeTime: istToUtc(show.CutOffDateTime),
        screen: show.ScreenName || "",
        screenFormat: child.EventDimension || "",
        available: null,
        total: null,
        statusColor: STATUS_COLOR[show.AvailStatus] || "",
        availabilityRaw: show.AvailStatus ?? null,
        areas: (show.Categories || []).map((category) => ({
          label: category.PriceDesc || "",
          code: category.AreaCatCode || "",
          available: null,
          total: null,
          price: price(category.CurPrice),
          statusColor: STATUS_COLOR[category.AvailStatus] || "",
        })),
        tags: [],
        language: child.EventLanguage || "",
        bookingUrl,
      });
    }
  }
  return sessions.filter((session) => session.showTime).sort((a, b) => a.showTime.localeCompare(b.showTime));
}

const bmsClient = new BmsClient();

module.exports = bmsClient;
module.exports.BmsClient = BmsClient;
module.exports.BmsBlockedError = BmsBlockedError;
module.exports.BmsBudgetError = BmsBudgetError;
module.exports.MIN_INTERVAL_MS = MIN_INTERVAL_MS;
module.exports.JITTER_MS = JITTER_MS;
module.exports.DAILY_REQUEST_CAP = DAILY_REQUEST_CAP;
module.exports.parseRobots = parseRobots;
module.exports.istToUtc = istToUtc;
module.exports.toDistrictSessions = toDistrictSessions;
module.exports.STATUS_COLOR = STATUS_COLOR;
