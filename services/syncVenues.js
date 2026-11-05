const City = require("../models/City");
const Venue = require("../models/Venue");
const districtClient = require("../clients/districtClient");
const { reconcileBmsVenues } = require("./bmsVenues");
const logger = require("../utils/logger");

const TAG = "SyncVenues";

async function syncVenuesForCity(city) {
  logger.info(TAG, `Syncing venues for ${city.name} (ID: ${city._id})...`);

  let cinemas;
  try {
    cinemas = await districtClient.getAllCinemas(city.name);
  } catch (error) {
    logger.error(TAG, `Failed to fetch cinemas for ${city.name}`, error.message);
    return { success: false, error: error.message };
  }

  if (!cinemas || cinemas.length === 0) {
    logger.warn(TAG, `No cinemas returned for ${city.name}`);
    return { success: true, venues: 0 };
  }

  logger.info(TAG, `Fetched ${cinemas.length} cinemas for ${city.name}`);

  let upserted = 0;
  for (const cinema of cinemas) {
    try {
      await Venue.findOneAndUpdate(
        { cinema_id: String(cinema.cinemaId) },
        {
          $set: {
            name: cinema.name,
            address: cinema.address || null,
            city_name: city.name,
            provider_id: cinema.providerId || null,
            cinema_id: String(cinema.cinemaId),
            location: {
              type: "Point",
              coordinates: [cinema.longitude || 0, cinema.latitude || 0],
            },
            "extras.amenities": cinema.amenities || [],
          },
          $setOnInsert: {
            _id: cinema.cinemaId,
          },
        },
        { upsert: true }
      );
      upserted++;
    } catch (error) {
      if (error.code !== 11000) {
        logger.error(TAG, `Failed to upsert venue ${cinema.name} (${cinema.cinemaId})`, error.message);
      }
    }
  }

  logger.info(TAG, `${city.name}: ${upserted} venues upserted`);

  try {
    await reconcileBmsVenues(city);
  } catch (error) {
    logger.error(TAG, `Failed to reconcile BookMyShow venues for ${city.name}`, error.message);
  }

  try {
    await City.findOneAndUpdate({ _id: city._id }, { $set: { last_venue_sync_at: new Date() } });
  } catch (error) {
    logger.error(TAG, `Failed to update last_venue_sync_at for ${city.name}`, error.message);
  }

  if ((city.latitude == null || city.longitude == null) && cinemas.length > 0) {
    const validCoords = cinemas.filter(c => c.latitude && c.longitude);
    if (validCoords.length > 0) {
      const avgLat = validCoords.reduce((sum, c) => sum + c.latitude, 0) / validCoords.length;
      const avgLng = validCoords.reduce((sum, c) => sum + c.longitude, 0) / validCoords.length;
      try {
        await City.findOneAndUpdate(
          { _id: city._id },
          { $set: { latitude: avgLat, longitude: avgLng } }
        );
        logger.info(TAG, `Backfilled lat/lng for ${city.name}: ${avgLat}, ${avgLng}`);
      } catch (error) {
        logger.error(TAG, `Failed to backfill lat/lng for ${city.name}`, error.message);
      }
    }
  }

  return { success: true, venues: upserted };
}

async function syncVenues() {
  logger.info(TAG, "Starting venue sync for all active cities...");

  const cities = await City.find({ is_active: true });
  logger.info(TAG, `Found ${cities.length} active cities`);

  let totalVenues = 0;

  for (const city of cities) {
    try {
      const result = await syncVenuesForCity(city);
      if (result.success) totalVenues += result.venues;

      await new Promise((r) => setTimeout(r, 200));
    } catch (error) {
      logger.error(TAG, `Unexpected error syncing venues for ${city.name}`, error.message);
    }
  }

  logger.info(TAG, `Venue sync complete. ${totalVenues} venues processed across ${cities.length} cities.`);
  return { success: true, totalVenues, cities: cities.length };
}

module.exports = syncVenues;
module.exports.syncVenuesForCity = syncVenuesForCity;
