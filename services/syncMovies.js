const City = require("../models/City");
const Movie = require("../models/Movie");
const MovieFormat = require("../models/MovieFormat");
const MovieLanguage = require("../models/MovieLanguage");
const districtClient = require("../clients/districtClient");
const logger = require("../utils/logger");
const { dedupeIgnoreCase } = require("../utils/normalize");

const TAG = "SyncMovies";

async function syncMoviesForCity(city) {
  logger.info(TAG, `Syncing movies for ${city.name} (ID: ${city._id})...`);

  let groupedMovies;
  try {
    groupedMovies = await districtClient.getGroupedMovies(city.name);
  } catch (error) {
    logger.error(TAG, `Failed to fetch movies for ${city.name}`, error.message);
    return { success: false, error: error.message };
  }

  if (!groupedMovies || groupedMovies.length === 0) {
    logger.warn(TAG, `No movies returned for ${city.name}`);
    return { success: true, movies: 0 };
  }

  logger.info(TAG, `Fetched ${groupedMovies.length} grouped movies for ${city.name}`);

  let movieCount = 0;
  let formatCount = 0;
  let languageCount = 0;

  for (const gm of groupedMovies) {
    if (!(gm.contentId > 0)) continue;
    const allFrmtids = new Set();
    const allLanguages = new Set();
    const allFormatNames = new Set();

    for (const lg of gm.languageGroups || []) {
      if (lg.language) allLanguages.add(lg.language);
      if (lg.fmtGrpId) allFrmtids.add(lg.fmtGrpId);

      for (const sf of lg.screenFormats || []) {
        if (sf.movieCode) allFrmtids.add(sf.movieCode);
        if (sf.screenFormat) allFormatNames.add(sf.screenFormat);
      }
    }

    for (const screenFormat of gm.allScreenFormats || []) {
      if (screenFormat) allFormatNames.add(screenFormat);
    }

    const screenFormats = dedupeIgnoreCase(Array.from(allFormatNames));
    const languages = dedupeIgnoreCase(Array.from(allLanguages));

    const langFormatMap = {};
    for (const lg of gm.languageGroups || []) {
      for (const sf of lg.screenFormats || []) {
        if (sf.movieCode && lg.language) {
          langFormatMap[sf.movieCode] = lg.language;
        }
      }
    }

    try {
      const existing = await Movie.findOne({ contentId: gm.contentId })
        .select("frmtids extras.language_variants extras.screen_formats language_format_map")
        .lean();
      const existingMap = existing?.language_format_map || {};

      await Movie.findOneAndUpdate(
        { contentId: gm.contentId },
        {
          $set: {
            name: gm.name,
            image_url: gm.posterUrl || null,
            runtime_minutes: gm.duration || null,
            censor: gm.censor || null,
            frmtids: [...new Set([...(existing?.frmtids || []), ...allFrmtids])],
            release_date: gm.releaseDate || null,
            booking_status: gm.bookingStatus || null,
            "extras.genres": gm.genres || [],
            "extras.language_variants": dedupeIgnoreCase([...(existing?.extras?.language_variants || []), ...languages]),
            "extras.screen_formats": dedupeIgnoreCase([...(existing?.extras?.screen_formats || []), ...screenFormats]),
            language_format_map: { ...existingMap, ...langFormatMap },
            last_seen_active_at: new Date(),
          },
          $setOnInsert: { contentId: gm.contentId },
        },
        { upsert: true }
      );
      movieCount++;
    } catch (error) {
      logger.error(TAG, `Failed to upsert movie ${gm.name} (${gm.contentId})`, error.message);
    }

    for (const formatName of screenFormats) {
      try {
        await MovieFormat.findOneAndUpdate(
          { format_name: formatName },
          { $set: { format_name: formatName } },
          { upsert: true }
        );
        formatCount++;
      } catch (error) {
        if (error.code !== 11000) {
          logger.error(TAG, `Failed to upsert format ${formatName}`, error.message);
        }
      }
    }

    for (const langName of languages) {
      try {
        await MovieLanguage.findOneAndUpdate(
          { language_name: langName },
          { $set: { language_name: langName } },
          { upsert: true }
        );
        languageCount++;
      } catch (error) {
        if (error.code !== 11000) {
          logger.error(TAG, `Failed to upsert language ${langName}`, error.message);
        }
      }
    }
  }

  try {
    await City.findOneAndUpdate(
      { _id: city._id },
      { $set: { last_movie_sync_at: new Date() } }
    );
  } catch (error) {
    logger.error(TAG, `Failed to update last_movie_sync_at for ${city.name}`, error.message);
  }

  logger.info(
    TAG,
    `${city.name}: ${movieCount} movies, ${formatCount} formats, ${languageCount} languages`
  );
  return { success: true, movies: movieCount, formats: formatCount };
}

async function syncMovies() {
  logger.info(TAG, "Starting movie sync for all active cities...");

  const cities = await City.find({ is_active: true });
  logger.info(TAG, `Found ${cities.length} active cities`);

  let totalMovies = 0;

  for (const city of cities) {
    try {
      const result = await syncMoviesForCity(city);
      if (result.success) totalMovies += result.movies;

      await new Promise((r) => setTimeout(r, 200));
    } catch (error) {
      logger.error(TAG, `Unexpected error syncing ${city.name}`, error.message);
    }
  }

  logger.info(TAG, `Movie sync complete. ${totalMovies} movies processed across ${cities.length} cities.`);
  return { success: true, totalMovies, cities: cities.length };
}

module.exports = syncMovies;
module.exports.syncMoviesForCity = syncMoviesForCity;
