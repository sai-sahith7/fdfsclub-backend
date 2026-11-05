const City = require("../models/City");
const User = require("../models/User");
const UserDTO = require("../dtos/user.dto");
const districtClient = require("../clients/districtClient");
const { HttpError } = require("../utils/response");
const logger = require("../utils/logger");

const TAG = "LocationService";

const resolveUserLocation = async (lat, lng, email) => {
  let locationInfo;
  try {
    locationInfo = await districtClient.resolveLocation(lat, lng);
  } catch (error) {
    logger.error(TAG, "Failed to resolve location", error.message);
    throw new HttpError(502, "We couldn't detect your city right now. Please pick it from the list.");
  }

  if (!locationInfo.cityId || !locationInfo.cityName) {
    throw new HttpError(400, "We couldn't work out your city from your location. Please pick it from the list.");
  }

  const resolvedSlug = locationInfo.cityKey || locationInfo.cityName.toLowerCase().replace(/\s+/g, "-");
  const resolvedStateKey = locationInfo.stateKey || null;

  let city = await City.findOne({ slug: resolvedSlug, state_key: resolvedStateKey });

  if (!city) {
    city = await City.findById(locationInfo.cityId);
    if (city) {
      city.state_key = resolvedStateKey;
      if (locationInfo.lat != null) city.latitude = locationInfo.lat;
      if (locationInfo.lng != null) city.longitude = locationInfo.lng;
      await city.save();
    }
  }

  let catalogLoading = false;

  if (!city) {
    logger.info(TAG, `New city detected: ${locationInfo.cityName} (${locationInfo.cityId})`);

    const now = new Date();
    city = new City({
      _id: locationInfo.cityId,
      name: locationInfo.cityName,
      slug: resolvedSlug,
      state_key: resolvedStateKey,
      latitude: locationInfo.lat || lat,
      longitude: locationInfo.lng || lng,
      is_active: true,
      movie_sync_requested_at: now,
      venue_sync_requested_at: now,
      bms_sync_requested_at: now,
    });
    await city.save();

    catalogLoading = true;
  }

  const user = await User.findOneAndUpdate(
    { email },
    {
      $set: {
        "default_city.name": city.name,
        "default_city.slug": city.slug,
      },
    },
    { new: true }
  );

  if (!user) {
    throw new HttpError(404, "We couldn't find your account. Please sign in again.");
  }

  return {
    data: UserDTO.toLocationResponse(user, city, catalogLoading),
    message: catalogLoading
      ? `Found you in ${city.name}. We're still loading theatres there, so check back in a few minutes.`
      : `Found you in ${city.name}.`,
  };
};

module.exports = {
  resolveUserLocation,
};
