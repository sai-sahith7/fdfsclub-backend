const { getAlertDateOptions, toIsoDate, ALERT_DATE_WINDOW_DAYS } = require("../../utils/dateOptions");

const NOW = new Date("2026-07-26T06:30:00Z");

describe("getAlertDateOptions", () => {
  test("starts today when the movie is already released", () => {
    const options = getAlertDateOptions({ releaseDate: "2026-07-01", now: NOW });
    expect(options[0].iso).toBe("2026-07-26");
  });

  test("starts at the release date when the movie has not released yet", () => {
    const options = getAlertDateOptions({ releaseDate: "2026-07-30", now: NOW });
    expect(options[0].iso).toBe("2026-07-30");
  });

  test("starts today when the movie releases today", () => {
    const options = getAlertDateOptions({ releaseDate: "2026-07-26", now: NOW });
    expect(options[0].iso).toBe("2026-07-26");
  });

  test("spans the start date through +10 days inclusive", () => {
    const options = getAlertDateOptions({ releaseDate: "2026-07-30", now: NOW });
    expect(options).toHaveLength(ALERT_DATE_WINDOW_DAYS + 1);
    expect(options[0].iso).toBe("2026-07-30");
    expect(options[options.length - 1].iso).toBe("2026-08-09");
  });

  test("returns consecutive days with no gaps or repeats", () => {
    const isoDates = getAlertDateOptions({ now: NOW }).map((option) => option.iso);
    expect(new Set(isoDates).size).toBe(isoDates.length);

    for (let i = 1; i < isoDates.length; i++) {
      const previous = new Date(`${isoDates[i - 1]}T00:00:00Z`).getTime();
      const current = new Date(`${isoDates[i]}T00:00:00Z`).getTime();
      expect(current - previous).toBe(24 * 60 * 60 * 1000);
    }
  });

  test("crosses month boundaries correctly", () => {
    const options = getAlertDateOptions({ now: new Date("2026-01-28T06:30:00Z") });
    expect(options[0].iso).toBe("2026-01-28");
    expect(options[options.length - 1].iso).toBe("2026-02-07");
  });

  test("falls back to today when the release date is missing or unparseable", () => {
    expect(getAlertDateOptions({ now: NOW })[0].iso).toBe("2026-07-26");
    expect(getAlertDateOptions({ releaseDate: null, now: NOW })[0].iso).toBe("2026-07-26");
    expect(getAlertDateOptions({ releaseDate: "coming soon", now: NOW })[0].iso).toBe("2026-07-26");
  });

  test("accepts a full ISO timestamp as the release date", () => {
    const options = getAlertDateOptions({ releaseDate: "2026-07-30T00:00:00.000Z", now: NOW });
    expect(options[0].iso).toBe("2026-07-30");
  });

  test("labels each option with weekday, day and month", () => {
    const [first] = getAlertDateOptions({ releaseDate: "2026-07-30", now: NOW });
    expect(first.label).toBe("Thu, 30 Jul");
    expect(first.weekday).toBe("Thu");
    expect(first.day).toBe("30");
    expect(first.month).toBe("Jul");
  });

  test("uses the IST calendar day, not the UTC one", () => {
    const options = getAlertDateOptions({ now: new Date("2026-07-25T19:00:00Z") });
    expect(options[0].iso).toBe("2026-07-26");
  });

  test("honours a custom window size", () => {
    const options = getAlertDateOptions({ now: NOW, days: 3 });
    expect(options).toHaveLength(4);
  });
});

describe("toIsoDate", () => {
  test("formats an instant as the IST calendar day", () => {
    expect(toIsoDate(new Date("2026-07-25T19:00:00Z"))).toBe("2026-07-26");
    expect(toIsoDate(new Date("2026-07-25T17:00:00Z"))).toBe("2026-07-25");
  });
});
