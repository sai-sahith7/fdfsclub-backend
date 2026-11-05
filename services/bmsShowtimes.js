const bmsClient = require("../clients/bmsClient");
const { toDistrictSessions } = require("../clients/bmsClient");
const { slugify } = require("../utils/districtLink");

const CACHE_TTL_MS = 8 * 60 * 1000;

const cache = new Map();

function titleKey(title) {
  return slugify(String(title || "").replace(/\([^)]*\)/g, " ")).replace(/-/g, "");
}

function buildBmsVenueUrl({ regionSlug, venueName, venueCode, dateCode }) {
  return `https://in.bookmyshow.com/cinemas/${regionSlug}/${slugify(String(venueName || "").replace(/\./g, ""))}/buytickets/${venueCode}/${dateCode}`;
}

function isCached(venueCode, regionCode, dateCode) {
  const hit = cache.get(`${venueCode}:${regionCode}:${dateCode}`);
  return Boolean(hit && hit.expires > Date.now());
}

function venueShowtimes(venueCode, regionCode, dateCode, client = bmsClient) {
  const key = `${venueCode}:${regionCode}:${dateCode}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;

  const promise = client.getVenueShowtimes(venueCode, regionCode, dateCode);
  cache.set(key, { promise, expires: Date.now() + CACHE_TTL_MS });
  promise.catch(() => cache.delete(key));
  return promise;
}

function toCinema({ venue, region, dateCode, movie, showtimes }) {
  const wanted = titleKey(movie.name);
  const event = (showtimes?.events || []).find((item) => titleKey(item.title) === wanted);
  if (!event) return null;

  const bookingUrl = buildBmsVenueUrl({ regionSlug: region.slug, venueName: venue.name, venueCode: venue.bms_venue_code, dateCode });
  const sessions = toDistrictSessions(event, { cinemaId: venue._id, bookingUrl });
  if (sessions.length === 0) return null;

  const [longitude, latitude] = venue.location?.coordinates || [];
  return {
    source: "bookmyshow",
    cinemaId: venue._id,
    name: venue.name,
    address: venue.address || "",
    providerId: null,
    latitude: latitude || null,
    longitude: longitude || null,
    distanceKm: null,
    bookingUrl,
    sessions,
  };
}

function clearCache() {
  cache.clear();
}

module.exports = { venueShowtimes, toCinema, isCached, buildBmsVenueUrl, titleKey, clearCache, CACHE_TTL_MS };
