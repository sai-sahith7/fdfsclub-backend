function matchAlert(alert, cinemas) {
  const filters = alert.filters || {};
  const matches = [];
  const venueIds = (alert.venues || [])
    .filter(v => v.id != null)
    .map(v => v.id);
  const venueIdSet = new Set(venueIds);

  for (const cinema of cinemas) {
    if (venueIdSet.size > 0 && !venueIdSet.has(cinema.cinemaId)) {
      continue;
    }

    for (const session of cinema.sessions || []) {
      if (filters.formats && filters.formats.length > 0) {
        const sessionFormat = (session.screenFormat || "").toLowerCase();
        const matchesFormat = filters.formats.some(
          (f) => f.toLowerCase() === sessionFormat
        );
        if (!matchesFormat) continue;
      }

      if (filters.languages && filters.languages.length > 0) {
        const sessionLang = (session.language || "").toLowerCase();
        const matchesLang = filters.languages.some(
          (l) => l.toLowerCase() === sessionLang
        );
        if (!matchesLang) continue;
      }

      if (filters.show_time_min != null || filters.show_time_max != null) {
        const minutesFromMidnight = parseShowTimeToMinutes(session.showTime);
        if (minutesFromMidnight === null) continue;

        if (filters.show_time_min != null && minutesFromMidnight < filters.show_time_min) {
          continue;
        }
        if (filters.show_time_max != null && minutesFromMidnight > filters.show_time_max) {
          continue;
        }
      }

      if (filters.price_min != null || filters.price_max != null) {
        const minPrice = getMinAreaPrice(session);
        if (minPrice === null) continue;

        if (filters.price_min != null && minPrice < filters.price_min) continue;
        if (filters.price_max != null && minPrice > filters.price_max) continue;
      }

      if (session.statusColor === "R") {
        continue;
      }

      matches.push({ cinema, session });
    }
  }

  return matches;
}

function parseShowTimeToMinutes(showTime) {
  if (!showTime) return null;

  try {
    if (!showTime.includes("T") && showTime.includes(":")) {
      const [hours, minutes] = showTime.split(":").map(Number);
      if (isNaN(hours) || isNaN(minutes)) return null;
      return hours * 60 + minutes;
    }

    let parseStr = showTime;
    if (showTime.includes("T") && !showTime.endsWith("Z")) {
      parseStr += "Z";
    }

    const d = new Date(parseStr);
    if (isNaN(d.getTime())) return null;
    
    const timeString = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
    
    let [hours, minutes] = timeString.split(":").map(Number);
    if (hours === 24) hours = 0;
    
    if (isNaN(hours) || isNaN(minutes)) return null;
    return hours * 60 + minutes;
  } catch {
    return null;
  }
}

function getMinAreaPrice(session) {
  const areas = session.areas || [];
  if (areas.length === 0) return null;

  let min = Infinity;
  for (const area of areas) {
    if (area.price != null && area.price > 0 && area.price < min) {
      min = area.price;
    }
  }
  return min === Infinity ? null : min;
}

module.exports = matchAlert;
module.exports.parseShowTimeToMinutes = parseShowTimeToMinutes;
module.exports.getMinAreaPrice = getMinAreaPrice;
