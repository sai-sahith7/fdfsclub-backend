const IST_TIME_ZONE = "Asia/Kolkata";
const ALERT_DATE_WINDOW_DAYS = 10;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toIsoDate(date) {
  return date.toLocaleDateString("en-CA", { timeZone: IST_TIME_ZONE });
}

function parseIsoDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return isNaN(parsed.getTime()) ? null : parsed;
}

function getAlertDateOptions({ releaseDate, now = new Date(), days = ALERT_DATE_WINDOW_DAYS } = {}) {
  const today = parseIsoDate(toIsoDate(now));
  const release = parseIsoDate(releaseDate);

  const start = release && release > today ? release : today;

  const options = [];
  for (let offset = 0; offset <= days; offset++) {
    const date = new Date(start.getTime() + offset * MS_PER_DAY);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
    }).formatToParts(date);

    const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

    options.push({
      iso: date.toISOString().split("T")[0],
      weekday: lookup.weekday,
      day: lookup.day,
      month: lookup.month,
      label: `${lookup.weekday}, ${lookup.day} ${lookup.month}`,
    });
  }

  return options;
}

module.exports = {
  getAlertDateOptions,
  toIsoDate,
  parseIsoDate,
  ALERT_DATE_WINDOW_DAYS,
  IST_TIME_ZONE,
};
