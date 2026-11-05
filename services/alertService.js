const Alert = require("../models/Alert");
const City = require("../models/City");
const Movie = require("../models/Movie");
const Venue = require("../models/Venue");
const { HttpError } = require("../utils/response");
const { toIsoDate, parseIsoDate, ALERT_DATE_WINDOW_DAYS } = require("../utils/dateOptions");
const {
  MAX_ACTIVE_ALERTS_PER_USER,
  MAX_VENUES_PER_ALERT,
  MAX_ALERT_DAYS_AHEAD,
} = require("../constants/appConstants");
const crypto = require("crypto");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toNullableNumber = (value, { min, max }) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return undefined;
  return Math.round(number);
};

const toStringList = (value) =>
  Array.isArray(value)
    ? [...new Set(
      value
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim().slice(0, 40))
    )].slice(0, 20)
    : [];

function sanitizeFilters(input) {
  const filters = input && typeof input === "object" ? input : {};
  const result = {
    formats: toStringList(filters.formats),
    languages: toStringList(filters.languages),
    show_time_min: toNullableNumber(filters.show_time_min, { min: 0, max: 1439 }),
    show_time_max: toNullableNumber(filters.show_time_max, { min: 0, max: 1439 }),
    price_min: toNullableNumber(filters.price_min, { min: 0, max: 100000 }),
    price_max: toNullableNumber(filters.price_max, { min: 0, max: 100000 }),
  };

  if (Object.values(result).some((value) => value === undefined)) {
    throw new HttpError(400, "One of the show time or price filters isn't valid. Please check them and try again.");
  }
  if (result.show_time_min != null && result.show_time_max != null && result.show_time_min > result.show_time_max) {
    throw new HttpError(400, "The earliest show time must be before the latest one.");
  }
  if (result.price_min != null && result.price_max != null && result.price_min > result.price_max) {
    throw new HttpError(400, "The minimum price can't be more than the maximum price.");
  }
  return result;
}

function parseAlertDate(value) {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const text = value instanceof Date ? value.toISOString() : value.trim();
  if (!/^\d{4}-\d{2}-\d{2}($|T)/.test(text)) return null;
  const date = parseIsoDate(text);
  if (!date || date.toISOString().slice(0, 10) !== text.slice(0, 10)) return null;
  return date;
}

function endOfDayIst(alertDate) {
  return new Date(`${alertDate.toISOString().slice(0, 10)}T23:59:59.999+05:30`);
}

function lastAllowedDate(movie, today) {
  const release = parseIsoDate(movie?.release_date);
  const start = release && release > today ? release : today;
  const windowEnd = new Date(start.getTime() + ALERT_DATE_WINDOW_DAYS * MS_PER_DAY);
  const ceiling = new Date(today.getTime() + MAX_ALERT_DAYS_AHEAD * MS_PER_DAY);
  return windowEnd < ceiling ? windowEnd : ceiling;
}

const sameList = (a = [], b = []) =>
  a.length === b.length && [...a].map(String).sort().join("\u0000").toLowerCase() === [...b].map(String).sort().join("\u0000").toLowerCase();

function isSameAlert(existing, { venues, filters }) {
  const f = existing.filters || {};
  return (
    sameList((existing.venues || []).map((venue) => venue.id), venues.map((venue) => venue.id)) &&
    sameList(f.formats, filters.formats) &&
    sameList(f.languages, filters.languages) &&
    (f.show_time_min ?? null) === filters.show_time_min &&
    (f.show_time_max ?? null) === filters.show_time_max &&
    (f.price_min ?? null) === filters.price_min &&
    (f.price_max ?? null) === filters.price_max
  );
}

async function createAlertForUser(email, { movieId, city: cityInput, venueIds = [], alertDate: alertDateInput, filters: filterInput }, { now = new Date() } = {}) {
  const contentId = Number(movieId);
  if (movieId == null || movieId === "" || !Number.isInteger(contentId) || contentId <= 0) {
    throw new HttpError(400, "Please pick a movie.", "MOVIE_REQUIRED");
  }
  if (typeof cityInput !== "string" || !cityInput.trim()) {
    throw new HttpError(400, "Please pick a city.", "CITY_REQUIRED");
  }
  if (alertDateInput == null || alertDateInput === "") {
    throw new HttpError(400, "Please pick a date.", "DATE_REQUIRED");
  }

  const alertDate = parseAlertDate(alertDateInput);
  if (!alertDate) {
    throw new HttpError(400, "That date doesn't look right. Please pick one from the list.", "DATE_INVALID");
  }

  const filters = sanitizeFilters(filterInput);

  const cityName = cityInput.trim();
  const [movie, city] = await Promise.all([
    Movie.findOne({ contentId }).select("contentId name image_url release_date").lean(),
    City.findOne({ $or: [{ name: cityName }, { slug: cityName }] }).lean(),
  ]);
  if (!movie) {
    throw new HttpError(404, "We couldn't find that movie. Please search for it again.", "MOVIE_NOT_FOUND");
  }
  if (!city) {
    throw new HttpError(400, "We couldn't find that city. Please pick one from the list.", "CITY_NOT_FOUND");
  }

  const today = parseIsoDate(toIsoDate(now));
  if (alertDate < today) {
    throw new HttpError(400, "That date is in the past. Please pick today or a later day.", "DATE_PAST");
  }
  if (alertDate > lastAllowedDate(movie, today)) {
    throw new HttpError(400, "That date is too far ahead. Please pick one of the dates shown.", "DATE_TOO_FAR");
  }

  const uniqueIds = [...new Set(venueIds.map(Number).filter(Number.isFinite))];
  if (uniqueIds.length > MAX_VENUES_PER_ALERT) {
    throw new HttpError(400, `You can pick up to ${MAX_VENUES_PER_ALERT} theatres per alert.`, "TOO_MANY_THEATRES");
  }
  let venues = [];
  if (uniqueIds.length > 0) {
    const found = await Venue.find({ _id: { $in: uniqueIds }, city_name: city.name }).select("name source").lean();
    const byId = new Map(found.map((venue) => [venue._id, venue]));
    if (byId.size !== uniqueIds.length) {
      throw new HttpError(400, "Some of the theatres you picked aren't available any more. Please pick them again.", "THEATRE_NOT_FOUND");
    }
    venues = uniqueIds.map((id) => ({ id, name: byId.get(id).name, source: byId.get(id).source || "district" }));
  }

  const activeAlerts = await Alert.find({ user_email: email, status: "ACTIVE" })
    .select("movie.id city.name alert_date venues filters")
    .lean();
  if (activeAlerts.length >= MAX_ACTIVE_ALERTS_PER_USER) throw alertLimitError();
  const duplicate = activeAlerts.find((alert) =>
    alert.movie.id === contentId &&
    alert.city.name === city.name &&
    alert.alert_date.getTime() === alertDate.getTime() &&
    isSameAlert(alert, { venues, filters })
  );
  if (duplicate) throw duplicateAlertError();

  const alert = new Alert({
    _id: crypto.randomUUID(),
    user_email: email,
    movie: { id: movie.contentId, name: movie.name, image_url: movie.image_url || null },
    city: { name: city.name },
    venues,
    alert_date: alertDate,
    status: "ACTIVE",
    filters,
    last_scan_group_key: `${movie.contentId}:${city.name}:${alertDate.toISOString().slice(0, 10)}`,
    expires_at: endOfDayIst(alertDate),
    activated_at: new Date(),
  });
  await alert.save();

  const conflict = await findActivationConflict(email, alert._id);
  if (conflict) {
    await Alert.deleteOne({ _id: alert._id, status: "ACTIVE" });
    throw conflict === "duplicate" ? duplicateAlertError() : alertLimitError();
  }
  return alert;
}

function alertLimitError() {
  return new HttpError(
    409,
    `You already have ${MAX_ACTIVE_ALERTS_PER_USER} active alerts, which is the limit. Cancel one you no longer need to add another.`,
    "ALERT_LIMIT"
  );
}

function duplicateAlertError() {
  return new HttpError(409, "You already have this exact alert. We'll let you know as soon as tickets open.", "DUPLICATE_ALERT");
}

const activationTime = (alert) => new Date(alert.activated_at || alert.created_at).getTime();

const sameTarget = (a, b) =>
  a.movie.id === b.movie.id &&
  a.city.name === b.city.name &&
  a.alert_date.getTime() === b.alert_date.getTime() &&
  isSameAlert(a, { venues: b.venues || [], filters: sanitizeFilters(b.filters) });

async function findActivationConflict(email, alertId) {
  const active = await Alert.find({ user_email: email, status: "ACTIVE" })
    .select("movie.id city.name alert_date venues filters activated_at created_at")
    .lean();
  active.sort((a, b) => activationTime(a) - activationTime(b) || String(a._id).localeCompare(String(b._id)));

  const index = active.findIndex((item) => item._id === alertId);
  if (index === -1) return null;
  if (active.slice(0, index).some((earlier) => sameTarget(earlier, active[index]))) return "duplicate";
  return index >= MAX_ACTIVE_ALERTS_PER_USER ? "limit" : null;
}

module.exports = {
  createAlertForUser,
  findActivationConflict,
  alertLimitError,
  duplicateAlertError,
  sanitizeFilters,
  parseAlertDate,
  endOfDayIst,
  lastAllowedDate,
};
