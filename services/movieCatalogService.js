const Movie = require("../models/Movie");
const City = require("../models/City");
const districtClient = require("../clients/districtClient");
const logger = require("../utils/logger");
const { dedupeIgnoreCase } = require("../utils/normalize");

const TAG = "MovieCatalogService";

function extractScreenFormats(groupedMovie) {
  const formats = new Set();

  for (const screenFormat of groupedMovie.allScreenFormats || []) {
    if (screenFormat) formats.add(screenFormat);
  }
  for (const languageGroup of groupedMovie.languageGroups || []) {
    for (const screenFormat of languageGroup.screenFormats || []) {
      if (screenFormat.screenFormat) formats.add(screenFormat.screenFormat);
    }
  }

  return dedupeIgnoreCase(Array.from(formats));
}

function extractLanguages(groupedMovie) {
  const languages = (groupedMovie.languageGroups || [])
    .map((languageGroup) => languageGroup.language)
    .filter(Boolean);
  return dedupeIgnoreCase(languages);
}

async function backfillCityFormats(city) {
  const groupedMovies = await districtClient.getGroupedMovies(city.name);
  const byContentId = new Map();
  const operations = [];

  for (const groupedMovie of groupedMovies || []) {
    if (!groupedMovie.contentId) continue;

    const formats = extractScreenFormats(groupedMovie);
    const languages = extractLanguages(groupedMovie);
    byContentId.set(groupedMovie.contentId, { formats, languages });

    const update = {
      $addToSet: {
        "extras.screen_formats": { $each: formats },
        "extras.language_variants": { $each: languages },
      },
    };
    const codes = {};
    for (const languageGroup of groupedMovie.languageGroups || []) {
      for (const screenFormat of languageGroup.screenFormats || []) {
        if (languageGroup.language && /^[A-Za-z0-9_-]+$/.test(screenFormat.movieCode || "")) {
          codes[`language_format_map.${screenFormat.movieCode}`] = languageGroup.language;
        }
      }
    }
    if (Object.keys(codes).length > 0) update.$set = codes;
    operations.push({ updateOne: { filter: { contentId: groupedMovie.contentId }, update } });
  }

  if (operations.length > 0) {
    await Movie.bulkWrite(operations, { ordered: false });
    logger.info(TAG, `Backfilled filter options for ${operations.length} movies in ${city.name}`);
  }

  return byContentId;
}

async function resolveMovieFilterOptions(movie, cityName) {
  const cachedFormats = dedupeIgnoreCase(movie.extras?.screen_formats || []);
  const cachedLanguages = dedupeIgnoreCase(movie.extras?.language_variants || []);

  if (cachedFormats.length > 0 || !cityName) {
    return { formats: cachedFormats, languages: cachedLanguages };
  }

  const city = await City.findOne({ $or: [{ name: cityName }, { slug: cityName }] }).lean();
  if (!city) return { formats: cachedFormats, languages: cachedLanguages };

  try {
    const resolved = (await backfillCityFormats(city)).get(movie.contentId);
    return {
      formats: dedupeIgnoreCase([...cachedFormats, ...(resolved?.formats || [])]),
      languages: dedupeIgnoreCase([...cachedLanguages, ...(resolved?.languages || [])]),
    };
  } catch (error) {
    logger.error(TAG, `Failed to resolve filter options for ${movie.contentId} in ${city.name}`, error.message);
    return { formats: cachedFormats, languages: cachedLanguages };
  }
}

module.exports = {
  resolveMovieFilterOptions,
  backfillCityFormats,
  extractScreenFormats,
  extractLanguages,
};
