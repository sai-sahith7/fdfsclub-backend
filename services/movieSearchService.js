const Movie = require("../models/Movie");
const City = require("../models/City");
const districtClient = require("../clients/districtClient");
const logger = require("../utils/logger");
const { HttpError } = require("../utils/response");

const TAG = "MovieSearchService";

const DEFAULT_SEARCH_COORDS = { lat: 12.9716, lng: 77.5946 };

const findCity = async (cityName) => {
  if (!cityName) return null;
  return City.findOne({ $or: [{ name: cityName }, { slug: cityName }] }).lean();
};

const upsertSearchedMovie = async (result) => {
  const metadata = result.metadata || {};
  const contentId = Number(result.id);
  if (!Number.isFinite(contentId)) return false;

  const languageVariants = metadata.language
    ? String(metadata.language)
      .split(",")
      .map((lang) => lang.replace(/\s*\+\s*\d+\s*more\s*$/i, "").trim())
      .filter(Boolean)
    : [];

  await Movie.findOneAndUpdate(
    { contentId },
    {
      $set: {
        name: metadata.name || result.displayTitle,
        image_url: metadata.image_url || result.imageUrl || null,
        censor: metadata.censor_rating || null,
        requested_by_user: true,
      },
      $addToSet: { "extras.language_variants": { $each: languageVariants } },
    },
    { upsert: true }
  );
  return true;
};

const performUniversalSearch = async (keyword, cityName = null) => {
  const city = await findCity(cityName);
  const coords = city?.latitude != null && city?.longitude != null
    ? { lat: city.latitude, lng: city.longitude }
    : DEFAULT_SEARCH_COORDS;
  let searchResponse;
  try {
    const location = await districtClient.resolveLocation(coords.lat, coords.lng);
    searchResponse = await districtClient.search(keyword, "movies", location);
  } catch (error) {
    logger.error(TAG, `Movie search for "${keyword}" failed`, error.message);
    throw new HttpError(502, "We couldn't search for that movie right now. Please try again in a bit.");
  }
  let added = 0;
  for (const result of searchResponse.results || []) {
    if (result.entityType !== "EntityTypeMovie" || !(Number(result.id) > 0)) continue;
    try {
      if (await upsertSearchedMovie(result)) added++;
    } catch (error) {
      logger.error(TAG, `Failed to upsert movie ${result.id} from search`, error.message);
    }
  }
  return { added };
};

const refreshMoviesForCity = async (cityName, cityId) => {
  let city;
  if (typeof cityName === "string" && cityName) {
    city = await City.findOne({ name: cityName });
  }
  if (!city && cityId != null && cityId !== "") {
    if (isNaN(cityId)) {
      city = await City.findOne({ slug: String(cityId) });
    } else {
      city = await City.findById(Number(cityId));
    }
  }

  if (!city) {
    throw new HttpError(404, "We couldn't find that city.");
  }

  const recentThreshold = new Date(Date.now() - 30 * 60 * 1000);
  if (city.last_movie_sync_at && city.last_movie_sync_at > recentThreshold) {
    return {
      success: false,
      lastSync: city.last_movie_sync_at,
      message: "The movie list is already up to date.",
    };
  }

  if (!city.movie_sync_requested_at) {
    await City.updateOne({ _id: city._id }, { $set: { movie_sync_requested_at: new Date() } });
  }

  return {
    success: true,
    city: city.name,
    message: "We're refreshing the movie list. New movies will show up in a minute or two.",
  };
};

module.exports = {
  performUniversalSearch,
  upsertSearchedMovie,
  refreshMoviesForCity,
};
