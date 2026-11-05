const axios = require("axios");
const crypto = require("crypto");
const logger = require("../utils/logger");

const BASE_URL = "https://www.district.in";
const TAG = "districtClient";
const PAGE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const PAGE_CHECK_TIMEOUT_MS = 5000;

const DEFAULT_QUERY_PARAMS = {
  version: "3",
  site_id: "1",
  channel: "web",
  child_site_id: "1",
  platform: "district",
};

function randomBase36(length) {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateGuestToken() {
  const timestamp = Date.now();
  const randomInt = Math.floor(1e18 * Math.random());
  const randomStr = randomBase36(32);
  return `${timestamp}_${randomInt}_${randomStr}`;
}

function generateDeviceId() {
  return crypto.randomUUID();
}

function generateRequestId() {
  return crypto.randomUUID();
}

class DistrictClient {
  constructor() {
    this.guestToken = generateGuestToken();
    this.deviceId = generateDeviceId();

    this.http = axios.create({
      baseURL: BASE_URL,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        api_source: "district",
        "x-app-type": "ed_web",
        "x-guest-token": this.guestToken,
        "Content-Type": "application/json",
        Cookie: `x-device-id=${this.deviceId}`,
      },
    });
  }

  async _get(path, extraParams = {}) {
    const params = { ...DEFAULT_QUERY_PARAMS, ...extraParams };
    const res = await this.http.get(path, {
      params,
      headers: { "x-request-id": generateRequestId() },
    });
    return res.data;
  }

  async _post(path, body, extraParams = {}, extraHeaders = {}) {
    const params = { ...DEFAULT_QUERY_PARAMS, ...extraParams };
    const res = await this.http.post(path, body, {
      params,
      headers: { "x-request-id": generateRequestId(), ...extraHeaders },
    });
    return res.data;
  }

  async getCities() {
    const data = await this._get("/gw/consumer/movies/v3/cities");
    const citiesRaw = data?.data?.cities || data?.cities || [];
    return citiesRaw.map((cityItem) => ({
      id: cityItem.id,
      name: cityItem.name,
      value: cityItem.value || "",
      lat: cityItem.lat || null,
      lon: cityItem.lon || null,
      image_url: cityItem.imgPath || null,
    }));
  }

  async findCity(name) {
    const nameLower = name.toLowerCase();
    const cities = await this.getCities();
    return (
      cities.find(
        (cityItem) =>
          cityItem.name.toLowerCase().includes(nameLower) ||
          cityItem.value.toLowerCase().includes(nameLower)
      ) || null
    );
  }

  async getGroupedMovies(cityName) {
    const data = await this._get("/gw/consumer/movies/v3/movies", {
      city: cityName,
    });
    const inner = data?.data || data;
    const grouped = [];

    for (const movie of inner?.groupedMovies || []) {
      const languageGroups = [];
      for (const langGroup of movie.languageFormatGroups || []) {
        const screenFormats = (langGroup.screenFormats || []).map((screenFormat) => ({
          movieCode: screenFormat.movieCode || "",
          screenFormat: screenFormat.scrnFmt || "",
          nextAvailableDate: screenFormat.nextAvailableDate || "",
        }));
        languageGroups.push({
          language: langGroup.lang || "",
          fmtGrpId: langGroup.fmtGrpId || "",
          totalSessions: langGroup.totalSessionCount || 0,
          screenFormats,
        });
      }

      grouped.push({
        contentId: movie.contentId || 0,
        name: movie.label || "",
        posterUrl: movie.appImgPath || "",
        censor: movie.censor || "",
        duration: movie.duration || 0,
        genres: movie.grn || [],
        allScreenFormats: movie.scrnFmt || [],
        bookingStatus: movie.bookingStatus || "",
        popularityRank: movie.popularityRank || 0,
        releaseDate: movie.releaseDate || "",
        languageGroups,
      });
    }

    return grouped;
  }

  async getAllCinemas(cityName) {
    const data = await this._get("/gw/consumer/movies/v3/cinemas", {
      city: cityName,
    });
    const cinemasRaw = data?.data?.cinemas || [];
    return cinemasRaw.map((cinema) => {
      const amenities = [];
      if (cinema.amenitiesOrder) {
        for (const amenity of cinema.amenitiesOrder) {
          amenities.push(amenity.id);
        }
      }
      return {
        cinemaId: cinema.id || 0,
        providerId: cinema.pid || 0,
        name: cinema.name || "",
        address: cinema.address || "",
        pincode: cinema.pincode || "",
        latitude: cinema.lat || 0,
        longitude: cinema.lon || 0,
        cityId: cinema.cityId || 0,
        sessionCount: cinema.sessionCount || 0,
        amenities,
      };
    });
  }

  async getShowtimes({
    contentId,
    cityName,
    frmtid = "",
    date = "",
    lat,
    lng,
    movieCodeToLang = {},
  }) {
    if (lat == null || lng == null) {
      throw new Error(`lat/lng is required for getShowtimes (city: ${cityName})`);
    }

    const params = {
      city_key: cityName,
      content_id: String(contentId),
      latitude: String(lat),
      longitude: String(lng),
      cinemaOrderLogic: "3",
    };
    if (frmtid) params.movieCode = frmtid;
    if (date) params.date = date;

    const data = await this._get("/gw/consumer/movies/v5/movie", params);
    const showDates = data?.meta?.showDates || [];
    const pageData = data?.pageData || {};

    logger.info(TAG, `Showtimes for contentId=${contentId} in ${cityName}: ${showDates.length} dates`);

    const cinemas = [];
    for (const groupName of ["nearbyCinemas", "farCinemas"]) {
      for (const cinemaRaw of pageData[groupName] || []) {
        const cinemaInfo = cinemaRaw.cinemaInfo || {};
        const sessions = [];

        for (const sessionRaw of cinemaRaw.sessions || []) {
          const areas = (sessionRaw.areas || []).map((area) => ({
            label: area.label || "",
            code: area.code || "",
            available: area.sAvail || 0,
            total: area.sTotal || 0,
            price: area.price || 0,
            statusColor: area.statusColor || "",
          }));

          const movieCode = sessionRaw.mid || "";
          const resolvedLang = movieCodeToLang[movieCode] || "";

          sessions.push({
            sessionId: sessionRaw.sid || "",
            providerId: sessionRaw.pid || 0,
            cinemaId: sessionRaw.cid || cinemaRaw.id || 0,
            movieCode,
            showTime: sessionRaw.showTime || "",
            closeTime: sessionRaw.closeTime || "",
            screen: sessionRaw.audi || "",
            screenFormat: sessionRaw.scrnFmt || "",
            available: sessionRaw.avail || 0,
            total: sessionRaw.total || 0,
            statusColor: sessionRaw.statusColor || "",
            areas,
            tags: sessionRaw.tags || [],
            language: resolvedLang,
          });
        }

        if (sessions.length) {
          cinemas.push({
            cinemaId: cinemaRaw.id || 0,
            name: cinemaInfo.name || "",
            address: cinemaInfo.address || "",
            providerId: cinemaInfo.providerId || 0,
            latitude: cinemaInfo.latitude || 0,
            longitude: cinemaInfo.longitude || 0,
            distanceKm: cinemaRaw.distanceFromUser || 0,
            sessions,
          });
        }
      }
    }

    return { cinemas, dates: showDates };
  }

  async getSeatLayout({
    cinemaId,
    sessionId,
    providerId,
    movieCode,
    contentId,
    screenFormat = "2D",
    freeSeating = false,
  }) {
    const body = {
      cinemaId,
      sessionId,
      providerId,
      screenOnTop: true,
      freeSeating,
      screenFormat,
      moviecode: movieCode,
      config: { socialDistancing: 1 },
      contentId: String(contentId),
    };

    const data = await this._post("/gw/consumer/movies/v1/select-seat", body, {}, {
      paytmcinemaid: String(cinemaId),
    });

    const seatAreas = [];
    const seatLayout = data?.seatLayout || {};
    const colAreas = seatLayout.colAreas || {};
    const objAreas = colAreas.objArea || [];

    for (const area of objAreas) {
      const areaName = area.AreaDesc || "Unknown";
      const areaCode = area.AreaCode || "";
      const rowsDict = {};
      let availCount = 0;
      let totalCount = 0;

      for (const row of area.objRow || []) {
        const rowLabel = row.PhyRowId || "?";
        const seats = [];
        for (const seat of row.objSeat || []) {
          const rawStatus = String(seat.SeatStatus || "0");
          const status = rawStatus === "1" ? "1" : "0";
          seats.push({
            row: rowLabel,
            seatNumber: String(seat.seatNumber || ""),
            displayNumber: String(seat.displaySeatNumber || ""),
            status,
          });
          totalCount++;
          if (status === "0") availCount++;
        }
        rowsDict[rowLabel] = seats;
      }

      seatAreas.push({
        areaName,
        areaCode,
        rows: rowsDict,
        availableCount: availCount,
        totalCount: totalCount,
      });
    }

    return seatAreas;
  }

  async resolveLocation(lat, lng) {
    const body = { gps_lat: lat, user_lng: lng, gps_lng: lng, user_lat: lat };
    const res = await this.http.post("/gw/web/pre_home", body, {
      headers: { "x-request-id": generateRequestId() },
    });
    const data = res.data;
    const locationData = data?.location_data || {};
    const availableTabs = data?.available_tabs || {};

    return {
      cityId: locationData.city_id || 0,
      cityName: locationData.city_name || "",
      cityKey: locationData.p_city_key || "",
      stateKey: locationData.p_state_key || "",
      countryId: locationData.country_id || "1",
      lat: locationData.user_lat || lat,
      lng: locationData.user_lng || lng,
      placeType: locationData.place_type || "",
      placeId: locationData.place_id || "",
      isMoviesAvailable: availableTabs.is_movies_available || false,
      isEventsAvailable: availableTabs.is_events_available || false,
      isDiningAvailable: availableTabs.is_dining_available || false,
    };
  }

  async pageExists(url) {
    try {
      const res = await axios.get(url, {
        headers: { "User-Agent": PAGE_USER_AGENT },
        maxRedirects: 0,
        timeout: PAGE_CHECK_TIMEOUT_MS,
        validateStatus: () => true,
        responseType: "stream",
      });
      res.data?.destroy?.();
      if (res.status === 200) return true;
      if (res.status === 404) return false;
      return null;
    } catch {
      return null;
    }
  }

  setLocation(location) {
    this.http.defaults.headers.common = {
      ...this.http.defaults.headers.common,
      ...locationHeaders(location),
    };
  }

  async search(keyword, tabId = "all", location = null) {
    const body = {
      get_search_results_request_type: 1,
      post_body: { hp_selected_tab_id: "home_v2" },
      search_id: crypto.randomUUID(),
      keyword,
      tab_id: tabId,
    };

    const data = await this._post("/gw/web/search", body, {}, location ? locationHeaders(location) : {});

    const results = (data?.results || []).map(result => ({
      id: result.id,
      displayTitle: result.display_title || "",
      displaySubtitle: result.display_subtitle || "",
      domainTitle: result.domain_title || "",
      entityType: result.entity_type || "",
      imageUrl: result.image_url || "",
      metadata: result.metadata || {},
    }));

    return { results };
  }
}

function locationHeaders(location) {
  return {
    "x-city-id": String(location.cityId),
    "x-pcity-id": String(location.cityId),
    "x-user-lat": String(location.lat),
    "x-user-lng": String(location.lng),
    "x-pcity-key": location.cityKey,
    "x-city-key": location.cityKey,
    "x-pstate-key": location.stateKey,
    "x-country-id": String(location.countryId),
    "x-place-type": location.placeType,
    "x-place-id": location.placeId,
    "x-is-events-supported": String(location.isEventsAvailable),
    "x-is-movies-supported": String(location.isMoviesAvailable),
    "x-is-dining-supported": String(location.isDiningAvailable),
  };
}

const districtClient = new DistrictClient();

module.exports = districtClient;
module.exports.DistrictClient = DistrictClient;
