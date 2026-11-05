const City = require("../models/City");
const districtClient = require("../clients/districtClient");
const logger = require("../utils/logger");

const TAG = "SyncCities";
const MIN_CITIES_SANITY = 10;

async function syncCities() {
  logger.info(TAG, "Starting city sync...");

  let cities;
  try {
    cities = await districtClient.getCities();
  } catch (error) {
    logger.error(TAG, "Failed to fetch cities from District API", error.message);
    return { success: false, error: error.message };
  }

  if (cities.length < MIN_CITIES_SANITY) {
    logger.error(
      TAG,
      `Aborting: only ${cities.length} cities returned (expected >= ${MIN_CITIES_SANITY}). Possible bad API response.`
    );
    return { success: false, error: "Too few cities returned" };
  }

  logger.info(TAG, `Fetched ${cities.length} cities from District`);

  const seenIds = new Set();
  let upserted = 0;

  for (const city of cities) {
    seenIds.add(city.id);
    try {
      const slug = city.value || city.name.toLowerCase().replace(/\s+/g, "-");
      const existingCity = await City.findOne({
        $or: [
          { slug },
          { _id: city.id },
        ]
      });

      if (existingCity) {
        existingCity.name = city.name;
        existingCity.slug = slug;
        existingCity.latitude = city.lat != null ? city.lat : existingCity.latitude;
        existingCity.longitude = city.lon != null ? city.lon : existingCity.longitude;
        existingCity.image_url = city.image_url || existingCity.image_url;
        existingCity.is_active = true;
        await existingCity.save();
      } else {
        await City.create({
          _id: city.id,
          name: city.name,
          slug,
          state_key: city.value || null,
          latitude: city.lat,
          longitude: city.lon,
          image_url: city.image_url,
          is_active: true,
        });
      }
      upserted++;
    } catch (error) {
      logger.error(TAG, `Failed to upsert city ${city.name} (${city.id})`, error.message);
    }
  }

  logger.info(TAG, "Skipping marking removed cities as inactive per policy");

  logger.info(TAG, `City sync complete. ${upserted} cities upserted.`);
  return { success: true, upserted, total: cities.length };
}

module.exports = syncCities;
