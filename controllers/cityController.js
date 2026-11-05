const City = require("../models/City");
const Venue = require("../models/Venue");
const CityDTO = require("../dtos/city.dto");
const VenueDTO = require("../dtos/venue.dto");
const { sendSuccess, sendError, sendServerError } = require("../utils/response");
const { FAMOUS_CITIES } = require("../constants/appConstants");
const { syncVenuesForCity } = require("../services/syncVenues");

const TAG = "CityController";
const VENUE_REFRESH_COOLDOWN_MS = 30 * 60 * 1000;

const findCityByIdentifier = (identifier) =>
  isNaN(identifier) ? City.findOne({ slug: String(identifier) }) : City.findById(Number(identifier));

const getCities = async (req, res) => {
  try {
    const cities = await City.find({ is_active: true }).sort({ name: 1 }).lean();
    const sortedCities = cities.sort((cityA, cityB) => {
      const aFamous = FAMOUS_CITIES.indexOf(cityA.slug.toLowerCase());
      const bFamous = FAMOUS_CITIES.indexOf(cityB.slug.toLowerCase());

      if (aFamous !== -1 && bFamous !== -1) return aFamous - bFamous;
      if (aFamous !== -1) return -1;
      if (bFamous !== -1) return 1;
      return cityA.name.localeCompare(cityB.name);
    });
    res.set("Cache-Control", "public, max-age=300");
    sendSuccess(res, CityDTO.toCollectionResponse(sortedCities));
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

const getCityVenues = async (req, res) => {
  try {
    const city = await findCityByIdentifier(req.params.cityId);
    if (!city) return sendError(res, "We couldn't find that city.", 404);

    const venues = await Venue.find({ city_name: city.name }).sort({ name: 1 }).lean();
    sendSuccess(res, VenueDTO.toCollectionResponse(venues));
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

const refreshCityVenues = async (req, res) => {
  try {
    const city = await findCityByIdentifier(req.params.cityId);
    if (!city) return sendError(res, "We couldn't find that city.", 404);

    const lastSync = city.last_venue_sync_at;
    if (lastSync && Date.now() - lastSync.getTime() < VENUE_REFRESH_COOLDOWN_MS) {
      return sendSuccess(
        res,
        { refreshed: false, last_sync: lastSync },
        "The theatre list is already up to date. Try a different spelling, or check back later."
      );
    }

    const result = await syncVenuesForCity(city);
    if (!result.success) {
      return sendError(res, "We couldn't refresh the theatre list right now. Please try again in a bit.", 502);
    }

    const bmsDue = !city.last_bms_sync_at || Date.now() - city.last_bms_sync_at.getTime() >= VENUE_REFRESH_COOLDOWN_MS;
    if (bmsDue && !city.bms_sync_requested_at) {
      await City.updateOne({ _id: city._id }, { $set: { bms_sync_requested_at: new Date() } });
    }

    sendSuccess(
      res,
      { refreshed: true, venues: result.venues, more_coming: bmsDue },
      "Theatre list refreshed"
    );
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

module.exports = { getCities, getCityVenues, refreshCityVenues };
