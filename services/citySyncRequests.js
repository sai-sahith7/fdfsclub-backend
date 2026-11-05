const City = require("../models/City");
const { syncMoviesForCity } = require("./syncMovies");
const { syncVenuesForCity } = require("./syncVenues");
const { syncBmsVenuesForCity } = require("./bmsVenues");
const logger = require("../utils/logger");

const TAG = "CitySyncRequests";
const DISTRICT_CITIES_PER_RUN = 5;

function clearRequest(city, field, requestedAt) {
  return City.updateOne({ _id: city._id, [field]: requestedAt }, { $set: { [field]: null } });
}

async function processDistrictSyncRequests() {
  const cities = await City.find({
    $or: [{ movie_sync_requested_at: { $ne: null } }, { venue_sync_requested_at: { $ne: null } }],
  })
    .sort({ movie_sync_requested_at: 1, venue_sync_requested_at: 1 })
    .limit(DISTRICT_CITIES_PER_RUN);

  if (cities.length === 0) {
    logger.debug(TAG, "No city sync requests");
    return { success: true, cities: 0 };
  }

  for (const city of cities) {
    if (city.movie_sync_requested_at) {
      const requestedAt = city.movie_sync_requested_at;
      const result = await syncMoviesForCity(city).catch((error) => ({ success: false, error: error.message }));
      if (result.success) await clearRequest(city, "movie_sync_requested_at", requestedAt);
      else logger.warn(TAG, `Movie sync for ${city.name} failed; will retry`, result.error);
    }
    if (city.venue_sync_requested_at) {
      const requestedAt = city.venue_sync_requested_at;
      const result = await syncVenuesForCity(city).catch((error) => ({ success: false, error: error.message }));
      if (result.success) await clearRequest(city, "venue_sync_requested_at", requestedAt);
      else logger.warn(TAG, `Venue sync for ${city.name} failed; will retry`, result.error);
    }
  }
  return { success: true, cities: cities.length };
}

async function processBmsSyncRequests({ client } = {}) {
  const city = await City.findOne({ bms_sync_requested_at: { $ne: null }, is_active: true })
    .sort({ bms_sync_requested_at: 1 });
  if (!city) {
    logger.debug(TAG, "No theatre discovery requests");
    return { success: true, cities: 0 };
  }

  const requestedAt = city.bms_sync_requested_at;
  const result = await syncBmsVenuesForCity(city, client ? { client } : undefined);
  const blocked = !result.success && /paused|denied|rate limited|budget/i.test(result.error || "");
  if (!blocked) await clearRequest(city, "bms_sync_requested_at", requestedAt);
  return { success: result.success, cities: 1, city: city.name, blocked };
}

module.exports = { processDistrictSyncRequests, processBmsSyncRequests };
