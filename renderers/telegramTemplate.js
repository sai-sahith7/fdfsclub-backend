const { escapeMarkdown } = require("../utils/telegramMarkdown");

const TELEGRAM_CAPTION_LIMIT = 1024;

function formatShowtime(raw) {
  if (!raw) return "";
  const parseStr = raw.includes("T") && !raw.endsWith("Z") ? `${raw}Z` : raw;
  const date = new Date(parseStr);
  if (isNaN(date.getTime())) return raw;
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
}

function renderTelegramCaption(payload, limit = TELEGRAM_CAPTION_LIMIT) {
  const { movie, matches, booking_url } = payload;

  const header = `🎟 *${escapeMarkdown(movie)}*\nTickets are open! Book soon, seats go fast.\n\n`;
  if (!matches || matches.length === 0) return header;

  const bookingUrl = booking_url || matches[0].booking_url || "https://www.district.in/movies";
  const anyDistrict = matches.some((match) => (match.source || "district") === "district");
  const footer = `[Book on ${anyDistrict ? "District" : "BookMyShow"}](${bookingUrl})`;

  const grouped = new Map();
  for (const match of matches) {
    if (!grouped.has(match.venue)) grouped.set(match.venue, []);
    grouped.get(match.venue).push(match);
  }

  const venueBlocks = [];
  for (const [venue, venueMatches] of grouped) {
    const times = venueMatches.map((match) => formatShowtime(match.showtime)).filter(Boolean);
    const timesLine = times.length > 0
      ? escapeMarkdown(times.join(", "))
      : `${venueMatches.length} ${venueMatches.length === 1 ? "showtime" : "showtimes"}`;
    const [first] = venueMatches;
    const bmsLine = first.source === "bookmyshow" && anyDistrict && first.booking_url
      ? `\n[Book on BookMyShow](${first.booking_url})`
      : "";
    venueBlocks.push(`*${escapeMarkdown(venue)}*\n${timesLine}${bmsLine}\n\n`);
  }

  let body = "";
  for (let i = 0; i < venueBlocks.length; i++) {
    const remaining = venueBlocks.length - i;
    const moreLine = `…and ${remaining} more ${remaining === 1 ? "theatre" : "theatres"}\n\n`;
    const room = limit - header.length - footer.length - body.length;
    const needsMoreLine = i < venueBlocks.length - 1;
    if (venueBlocks[i].length + (needsMoreLine ? moreLine.length : 0) > room) {
      body += moreLine;
      break;
    }
    body += venueBlocks[i];
  }

  return header + body + footer;
}

module.exports = { renderTelegramCaption, TELEGRAM_CAPTION_LIMIT };
