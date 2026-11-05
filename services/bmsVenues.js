const Alert = require("../models/Alert");
const City = require("../models/City");
const Venue = require("../models/Venue");
const bmsClient = require("../clients/bmsClient");
const { BmsBlockedError } = require("../clients/bmsClient");
const { slugify } = require("../utils/districtLink");
const logger = require("../utils/logger");

const TAG = "BmsVenues";
const MAX_MOVIES_PER_CITY = 40;
const SAME_SITE_METERS = 200;
const SAME_BUILDING_METERS = 60;

const GENERIC_WORDS = new Set([
  "the", "and", "of", "a", "c", "ac", "x", "k", "new", "newly", "renovated", "formerly",
  "sri", "sree", "shri", "shree",
  "cinema", "cinemas", "cineplex", "multiplex", "theatre", "theater", "theatres", "theaters",
  "talkies", "screen", "screens", "mall", "movies", "movie", "india", "road", "roads",
  "dolby", "atmos", "laser", "dts", "digital", "70mm", "35mm", "4k", "2k", "rgb", "imax", "ltd", "pvt",
]);

const AMENITY_IDS = { CAR: "2", FOD: "3" };

function bmsVenueId(code) {
  if (!/^[A-Za-z0-9]{1,10}$/.test(String(code || ""))) throw new Error(`Invalid BookMyShow venue code: ${code}`);
  return -parseInt(String(code).toLowerCase(), 36);
}

function nameTokens(name, extraGeneric = []) {
  const generic = new Set([...GENERIC_WORDS, ...extraGeneric]);
  const tokens = slugify(name)
    .split("-")
    .filter(Boolean)
    .map((token) => (token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token))
    .filter((token) => !generic.has(token));
  return [...new Set(tokens)];
}

function distanceMeters(a, b) {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return null;
  const rad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function venuePoint(venue) {
  const [lng, lat] = venue.location?.coordinates || [];
  return lat || lng ? { latitude: lat, longitude: lng } : { latitude: null, longitude: null };
}

function wordsMatch(x, y) {
  return x === y || (Math.min(x.length, y.length) >= 5 && (x.startsWith(y) || y.startsWith(x)));
}

function sharedWords(from, against) {
  const pool = [...against];
  for (let i = 0; i < against.length - 1; i++) pool.push(against[i] + against[i + 1]);
  return from.filter((token) => pool.some((other) => wordsMatch(token, other))).length;
}

function isSameVenue(candidate, districtVenue, cityWords = []) {
  const listA = nameTokens(candidate.name, cityWords);
  const listB = nameTokens(districtVenue.name, cityWords);
  if (listA.length === 0 || listB.length === 0) return false;

  const sharedA = sharedWords(listA, listB);
  const sharedB = sharedWords(listB, listA);
  const overlap = Math.max(sharedA / listA.length, sharedB / listB.length);
  const sameChain = sharedWords([listA[0]], listB) === 1 || sharedWords([listB[0]], listA) === 1;
  const distance = distanceMeters(candidate, venuePoint(districtVenue));

  if (distance != null && distance > 2000) return false;
  if (sharedA === listA.length && sharedB === listB.length) return true;
  if (Math.min(listA.length, listB.length) >= 2 && overlap >= 0.8 && sameChain) return true;
  if (distance == null) return false;
  if (distance <= SAME_SITE_METERS && overlap >= 0.5 && sameChain) return true;
  return distance <= SAME_BUILDING_METERS && sameChain;
}

function cityWords(city) {
  return [...nameTokens(city.name), ...nameTokens(city.bms_region?.slug || ""), ...nameTokens(city.slug || "")];
}

async function resolveBmsRegion(city, client = bmsClient) {
  if (city.bms_region?.code) return city.bms_region;

  const regions = await client.getRegions();
  const name = city.name.toLowerCase();
  const slug = String(city.slug || "").toLowerCase();
  const region =
    regions.find((item) => item.slug && item.slug.toLowerCase() === slug) ||
    regions.find((item) => item.name.toLowerCase() === name) ||
    regions.find((item) => item.aliases.some((alias) => String(alias).toLowerCase() === name || String(alias).toLowerCase() === slug));
  if (!region || !region.slug) return null;

  const bmsRegion = { code: region.code, slug: region.slug };
  await City.updateOne({ _id: city._id }, { $set: { bms_region: bmsRegion } });
  city.bms_region = bmsRegion;
  return bmsRegion;
}

function istDateCode(offsetDays = 0) {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return ist.toISOString().slice(0, 10).replace(/-/g, "");
}

async function reconcileBmsVenues(city) {
  const [bmsVenues, districtVenues] = await Promise.all([
    Venue.find({ city_name: city.name, source: "bookmyshow" }).lean(),
    Venue.find({ city_name: city.name, source: { $ne: "bookmyshow" } }).lean(),
  ]);
  if (bmsVenues.length === 0 || districtVenues.length === 0) return { retired: 0 };

  const words = cityWords(city);
  let retired = 0;
  for (const bmsVenue of bmsVenues) {
    const candidate = { name: bmsVenue.name, ...venuePoint(bmsVenue) };
    const districtVenue = districtVenues.find((venue) => isSameVenue(candidate, venue, words));
    if (!districtVenue) continue;

    await Alert.updateMany(
      { "venues.id": { $all: [bmsVenue._id, districtVenue._id] } },
      { $pull: { venues: { id: bmsVenue._id } } }
    );
    await Alert.updateMany(
      { "venues.id": bmsVenue._id },
      { $set: { "venues.$[v].id": districtVenue._id, "venues.$[v].name": districtVenue.name, "venues.$[v].source": "district" } },
      { arrayFilters: [{ "v.id": bmsVenue._id }] }
    );
    await Venue.deleteOne({ _id: bmsVenue._id, source: "bookmyshow" });
    retired++;
    logger.info(TAG, `${city.name}: District now lists "${districtVenue.name}", retired BookMyShow venue ${bmsVenue.bms_venue_code}`);
  }
  return { retired };
}

async function syncBmsVenuesForCity(city, { client = bmsClient, dateCode = istDateCode(1) } = {}) {
  let region;
  try {
    region = await resolveBmsRegion(city, client);
  } catch (error) {
    logger.error(TAG, `Failed to resolve BookMyShow region for ${city.name}`, error.message);
    return { success: false, error: error.message };
  }
  if (!region) return { success: true, venues: 0, skipped: "no BookMyShow region" };

  const found = new Map();
  try {
    const movies = (await client.getCityMovies(region.slug, region.code)).slice(0, MAX_MOVIES_PER_CITY);
    for (const movie of movies) {
      try {
        for (const venue of await client.getVenuesForEvent(movie.eventCode, region.code, dateCode)) {
          found.set(venue.code, venue);
        }
      } catch (error) {
        if (error instanceof BmsBlockedError) throw error;
        logger.warn(TAG, `${city.name}: no BookMyShow venues for ${movie.eventCode}`, error.message);
      }
    }
  } catch (error) {
    logger.error(TAG, `BookMyShow venue discovery failed for ${city.name}`, error.message);
    return { success: false, error: error.message };
  }

  const [districtVenues, existing] = await Promise.all([
    Venue.find({ city_name: city.name, source: { $ne: "bookmyshow" } }).lean(),
    Venue.find({ city_name: city.name, source: "bookmyshow" }).select("bms_venue_code").lean(),
  ]);
  const known = new Set(existing.map((venue) => venue.bms_venue_code));
  const words = cityWords(city);
  let added = 0;
  let common = 0;

  for (const [code, listed] of found) {
    if (known.has(code)) continue;
    if (districtVenues.some((venue) => isSameVenue({ name: listed.name }, venue, words))) {
      common++;
      continue;
    }

    let details;
    try {
      ({ venue: details } = await client.getVenueShowtimes(code, region.code, dateCode));
    } catch (error) {
      if (error instanceof BmsBlockedError) break;
      logger.warn(TAG, `${city.name}: could not load BookMyShow venue ${code}`, error.message);
      continue;
    }
    if (!details) continue;
    if (districtVenues.some((venue) => isSameVenue(details, venue, words))) {
      common++;
      continue;
    }

    try {
      await Venue.updateOne(
        { _id: bmsVenueId(code) },
        {
          $set: {
            name: details.name,
            address: details.address,
            city_name: city.name,
            provider_id: null,
            cinema_id: `bms:${code}`,
            location: { type: "Point", coordinates: [details.longitude || 0, details.latitude || 0] },
            "extras.chain": details.chain,
            "extras.amenities": details.amenities.map((code) => AMENITY_IDS[code]).filter(Boolean),
            source: "bookmyshow",
            bms_venue_code: code,
          },
        },
        { upsert: true }
      );
      added++;
    } catch (error) {
      logger.error(TAG, `Failed to store BookMyShow venue ${code}`, error.message);
    }
  }

  const { retired } = await reconcileBmsVenues(city);
  await City.updateOne({ _id: city._id }, { $set: { last_bms_sync_at: new Date() } });
  logger.info(TAG, `${city.name}: ${found.size} BookMyShow venues seen, ${common} also on District, ${added} BookMyShow-only added, ${retired} retired`);
  return { success: true, seen: found.size, common, venues: added, retired };
}

async function citiesInUse() {
  const User = require("../models/User");
  const { FAMOUS_CITIES } = require("../constants/appConstants");
  const [alertCities, users] = await Promise.all([
    Alert.distinct("city.name", { status: "ACTIVE" }),
    User.find({}, { "default_city.slug": 1, "favourite_city.slug": 1 }).lean(),
  ]);
  const slugs = new Set(FAMOUS_CITIES);
  for (const user of users) {
    if (user.default_city?.slug) slugs.add(user.default_city.slug);
    if (user.favourite_city?.slug) slugs.add(user.favourite_city.slug);
  }
  return City.find({ is_active: true, $or: [{ name: { $in: alertCities } }, { slug: { $in: [...slugs] } }] });
}

async function syncBmsVenues() {
  const cities = await citiesInUse();
  logger.info(TAG, `Syncing BookMyShow-only venues for ${cities.length} cities`);
  let total = 0;
  for (const city of cities) {
    const result = await syncBmsVenuesForCity(city);
    if (result.success) total += result.venues;
    if (!result.success && /paused|denied|rate limited|budget/i.test(result.error || "")) break;
  }
  return { success: true, cities: cities.length, venues: total };
}

module.exports = syncBmsVenues;
module.exports.syncBmsVenuesForCity = syncBmsVenuesForCity;
module.exports.reconcileBmsVenues = reconcileBmsVenues;
module.exports.resolveBmsRegion = resolveBmsRegion;
module.exports.isSameVenue = isSameVenue;
module.exports.bmsVenueId = bmsVenueId;
module.exports.istDateCode = istDateCode;
