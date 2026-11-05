const { BmsClient, BmsBlockedError, BmsBudgetError, parseRobots, istToUtc, toDistrictSessions } = require("../../clients/bmsClient");

function fakeHttp(routes) {
  const calls = [];
  return {
    calls,
    fetch: async (url, options) => {
      calls.push({ url, options });
      const path = url.replace("https://in.bookmyshow.com", "");
      const route = routes.find(([prefix]) => path.startsWith(prefix));
      const [, status, body, headers = {}] = route || [null, 404, "not found"];
      return {
        status,
        headers: { get: (name) => headers[name.toLowerCase()] ?? null, getSetCookie: () => headers["set-cookie"] ? [headers["set-cookie"]] : [] },
        text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      };
    },
  };
}

function clientWith(routes, options = {}) {
  let clock = 1_000_000;
  const sleeps = [];
  const http = fakeHttp([["/robots.txt", 200, "User-agent: *\nDisallow: /payment/\n"], ...routes]);
  const client = new BmsClient({
    http,
    now: () => clock,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    ...options,
  });
  return { client, http, sleeps, advance: (ms) => { clock += ms; } };
}

const BYVENUE = {
  ShowDetails: [{
    Venues: { VenueCode: "PRHN", VenueName: "Prasads Multiplex: Hyderabad", VenueAdd: "Khairtabad", VenueLat: "17.4128", VenueLong: "78.4658", VenueCompName: "PRASADS", VenueLegends: ";WC;CAR;FOD;" },
    Event: [{
      EventTitle: "The Paradise",
      EventGroup: "EG00434659",
      ChildEvents: [{
        EventCode: "ET00436621", EventLanguage: "Telugu", EventDimension: "2D",
        ShowTimes: [
          { SessionId: "256713", ShowDateCode: "20260927", ShowDateTime: "202609271905", CutOffDateTime: "202609271850", AvailStatus: "2", ScreenName: "SCREEN 6",
            Categories: [{ PriceDesc: "EXECUTIVE", AreaCatCode: "0002", CurPrice: "390.00", AvailStatus: "2" }] },
          { SessionId: "999", ShowDateCode: "20260928", ShowDateTime: "202609281000", AvailStatus: "3", Categories: [] },
        ],
      }],
    }],
  }],
};

describe("robots.txt", () => {
  test("honours the * group, wildcards and longest match", () => {
    const allowed = parseRobots([
      "User-agent: Googlebot", "Disallow: /", "",
      "User-agent: *", "Disallow: /payment/", "Disallow: /*-test$", "Allow: /payment/public",
    ].join("\n"));
    expect(allowed("/api/v3/mobile/showtimes/byvenue?venueCode=X")).toBe(true);
    expect(allowed("/payment/checkout")).toBe(false);
    expect(allowed("/payment/public/info")).toBe(true);
    expect(allowed("/explore/movies-test")).toBe(false);
    expect(allowed("/explore/movies-test-2")).toBe(true);
  });

  test("a disallowed path is never requested", async () => {
    const { client, http } = clientWith([]);
    await expect(client._request("/payment/x")).rejects.toThrow("robots.txt disallows");
    expect(http.calls.map((call) => call.url)).toEqual(["https://in.bookmyshow.com/robots.txt"]);
  });

  test("a challenged robots.txt is treated as no rules and does not pause", async () => {
    const http = fakeHttp([
      ["/robots.txt", 403, "<html><title>Just a moment...</title></html>", { "content-type": "text/html" }],
      ["/api/v3/mobile/showtimes/byvenue", 200, BYVENUE],
    ]);
    const client = new BmsClient({ http, now: () => 1_000_000, sleep: async () => {} });
    const { venue } = await client.getVenueShowtimes("PRHN", "HYD", "20260927");
    expect(venue.code).toBe("PRHN");
    expect(client.isPaused()).toBe(false);
  });
});

describe("conversions", () => {
  test("IST show codes become District-style UTC", () => {
    expect(istToUtc("202609271905")).toBe("2026-09-27T13:35");
    expect(istToUtc("202609280100")).toBe("2026-09-27T19:30");
    expect(istToUtc("1905")).toBe("");
  });
});

describe("BmsClient", () => {
  test("stops at the daily request cap and counts usage", async () => {
    const { client, http } = clientWith([["/api/v3/mobile/showtimes/byvenue", 200, BYVENUE]], { dailyCap: 3 });
    await client.getVenueShowtimes("PRHN", "HYD", "20260927");
    await client.getVenueShowtimes("PRHN", "HYD", "20260927");
    expect(client.usage()).toEqual({ sentToday: 3, dailyCap: 3 });
    await expect(client.getVenueShowtimes("PRHN", "HYD", "20260927")).rejects.toBeInstanceOf(BmsBudgetError);
    expect(http.calls.length).toBe(3);
  });

  test("the daily cap resets at IST midnight", async () => {
    const { client, advance } = clientWith([["/api/v3/mobile/showtimes/byvenue", 200, BYVENUE]], { dailyCap: 2 });
    await client.getVenueShowtimes("PRHN", "HYD", "20260927");
    await expect(client.getVenueShowtimes("PRHN", "HYD", "20260927")).rejects.toBeInstanceOf(BmsBudgetError);
    advance(24 * 3600 * 1000);
    await expect(client.getVenueShowtimes("PRHN", "HYD", "20260927")).resolves.toBeTruthy();
  });

  test("spaces requests at least 3 s apart", async () => {
    const { client, sleeps } = clientWith([["/api/v3/mobile/showtimes/byvenue", 200, BYVENUE]]);
    await client.getVenueShowtimes("PRHN", "HYD", "20260927");
    await client.getVenueShowtimes("PRHN", "HYD", "20260927");
    expect(sleeps.length).toBeGreaterThanOrEqual(2);
    for (const ms of sleeps) expect(ms).toBeGreaterThanOrEqual(3000);
  });

  test("city movies use the client's own visitor id and JSON headers, without a page load", async () => {
    const { client, http } = clientWith([["/api/explore/v1/discover/movies-bengaluru", 200, { listings: [] }]]);
    await client.getCityMovies("bengaluru", "BANG");
    await client.getCityMovies("bengaluru", "BANG");
    const api = http.calls.filter((call) => call.url.includes("/api/explore/v1/discover/movies-bengaluru"));
    expect(http.calls.some((call) => call.url.endsWith("/explore/movies-bengaluru"))).toBe(false);
    expect(api[0].options.headers.Accept).toMatch(/application\/json/);
    expect(api[0].options.headers["x-bms-id"]).toMatch(/^1\.\d+\.\d+$/);
    expect(api[1].options.headers["x-bms-id"]).toBe(api[0].options.headers["x-bms-id"]);
  });

  test("a challenge page pauses all traffic instead of retrying", async () => {
    const { client, http } = clientWith([
      ["/api/v3/mobile/showtimes/byvenue", 403, "<html><title>Just a moment...</title></html>", { "content-type": "text/html" }],
    ]);
    await expect(client.getVenueShowtimes("PRHN", "HYD", "20260927")).rejects.toBeInstanceOf(BmsBlockedError);
    const sent = http.calls.length;
    await expect(client.getRegions()).rejects.toBeInstanceOf(BmsBlockedError);
    expect(http.calls.length).toBe(sent);
  });

  test("denials in a row pause for 2, 4, 8 ... up to 30 min, and a success resets it", async () => {
    let status = 403;
    const http = fakeHttp([["/robots.txt", 200, ""]]);
    const fetch = http.fetch;
    http.fetch = async (url, options) => {
      const response = await fetch(url, options);
      return url.includes("byvenue") ? { ...response, status, text: async () => (status === 200 ? JSON.stringify(BYVENUE) : "") } : response;
    };
    let clock = 1_000_000;
    const client = new BmsClient({ http, now: () => clock, sleep: async (ms) => { clock += ms; } });
    const scan = () => client.getVenueShowtimes("PRHN", "HYD", "20260927");
    const pauses = [];
    for (let i = 0; i < 6; i++) {
      const before = clock;
      await expect(scan()).rejects.toBeInstanceOf(BmsBlockedError);
      pauses.push(client._pausedUntil - before);
      clock = client._pausedUntil;
    }
    expect(pauses.map((ms) => Math.round(ms / 60000))).toEqual([2, 4, 8, 16, 30, 30]);
    status = 200;
    await scan();
    status = 403;
    const before = clock;
    await expect(scan()).rejects.toBeInstanceOf(BmsBlockedError);
    expect(Math.round((client._pausedUntil - before) / 60000)).toBe(2);
  });

  test("a challenged regions list fails that call without pausing scans", async () => {
    const { client } = clientWith([
      ["/api/explore/v1/discover/regions", 403, "<html><title>Just a moment...</title></html>", { "content-type": "text/html" }],
      ["/api/v3/mobile/showtimes/byvenue", 200, BYVENUE],
    ]);
    await expect(client.getRegions()).rejects.not.toBeInstanceOf(BmsBlockedError);
    expect(client.isPaused()).toBe(false);
    await expect(client.getVenueShowtimes("PRHN", "HYD", "20260927")).resolves.toMatchObject({ venue: { code: "PRHN" } });
  });

  test("429 pauses for Retry-After", async () => {
    const { client, http, advance } = clientWith([["/api/explore/v1/discover/regions", 429, "{}", { "retry-after": "120" }]]);
    await expect(client.getRegions()).rejects.toBeInstanceOf(BmsBlockedError);
    advance(60_000);
    await expect(client.getRegions()).rejects.toThrow(/paused/);
    expect(http.calls.filter((call) => call.url.includes("regions")).length).toBe(1);
  });

  test("by-venue parsing keeps only shows on the requested date", async () => {
    const { client } = clientWith([["/api/v3/mobile/showtimes/byvenue", 200, BYVENUE]]);
    const { venue, events } = await client.getVenueShowtimes("PRHN", "HYD", "20260927");
    expect(venue).toMatchObject({ code: "PRHN", latitude: 17.4128, longitude: 78.4658, chain: "PRASADS", amenities: ["WC", "CAR", "FOD"] });
    expect(events[0].variants[0].shows.map((show) => show.SessionId)).toEqual(["256713"]);
  });

  test("sessions come out in District's shape", async () => {
    const { client } = clientWith([["/api/v3/mobile/showtimes/byvenue", 200, BYVENUE]]);
    const { events } = await client.getVenueShowtimes("PRHN", "HYD", "20260927");
    const [session] = toDistrictSessions(events[0], { cinemaId: -1202027, bookingUrl: "https://bms/x" });
    expect(session).toMatchObject({
      source: "bookmyshow", sessionId: "256713", cinemaId: -1202027, movieCode: "ET00436621",
      showTime: "2026-09-27T13:35", closeTime: "2026-09-27T13:20", screen: "SCREEN 6",
      screenFormat: "2D", language: "Telugu", statusColor: "Y", available: null, bookingUrl: "https://bms/x",
    });
    expect(session.areas).toEqual([{ label: "EXECUTIVE", code: "0002", available: null, total: null, price: 390, statusColor: "Y" }]);
  });
});
