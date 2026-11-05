jest.mock("satori-html", () => ({ html: (markup) => markup }));

const { renderAlertEmail, generateSeatMapHTML } = require("../../renderers/emailTemplate");
const { renderSatoriSeatMap } = require("../../renderers/satoriTemplate");
const { renderTelegramCaption } = require("../../renderers/telegramTemplate");

const SEAT_LAYOUT = [
  {
    areaName: "Executive",
    areaCode: "EXE",
    rows: {
      A: [
        { displayNumber: "1", status: "0" },
        { displayNumber: "2", status: "1" },
      ],
      B: [{ displayNumber: "1", status: "0" }],
    },
  },
];

const MATCH = {
  venue: "PVR Nexus",
  showtime: "2026-07-26T14:30:00",
  screen: "Audi 3",
  screen_format: "IMAX 2D",
  language: "English",
  seats_available: 42,
  price: 350,
  areas: [{ code: "EXE", label: "Executive", price: 350 }],
  booking_url: "https://www.district.in/movies/alpha-movie-tickets-in-pune-MV1",
};

const PAYLOAD = {
  movie: "Alpha",
  matches: [MATCH],
  seat_layout: SEAT_LAYOUT,
  booking_url: "https://www.district.in/movies/alpha-movie-tickets-in-pune-MV1",
};

const CARD_BORDER = "border: 1px solid #1c1c28";

describe("renderAlertEmail: seat map", () => {
  test("session details and the seat grid live in one card, not two", () => {
    const seatMapHtml = generateSeatMapHTML(SEAT_LAYOUT, MATCH);

    expect((seatMapHtml.match(new RegExp(CARD_BORDER, "g")) || []).length).toBe(1);
  });

  test("the seat map header sits above the availability grid in the same block", () => {
    const seatMapHtml = generateSeatMapHTML(SEAT_LAYOUT, MATCH);

    const cardIndex = seatMapHtml.indexOf(CARD_BORDER);
    const seatMapIndex = seatMapHtml.indexOf("Seat Map");
    const venueIndex = seatMapHtml.indexOf("PVR Nexus");
    const availabilityIndex = seatMapHtml.indexOf("Seat Availability");

    expect(cardIndex).toBeGreaterThan(-1);
    expect(seatMapIndex).toBeGreaterThan(cardIndex);
    expect(venueIndex).toBeGreaterThan(seatMapIndex);
    expect(availabilityIndex).toBeGreaterThan(venueIndex);
  });

  test("keeps a divider between the details and the grid", () => {
    const seatMapHtml = generateSeatMapHTML(SEAT_LAYOUT, MATCH);
    expect(seatMapHtml).toContain("border-bottom: 1px solid #1c1c28");
  });

  test("shows the session details next to the seats", () => {
    const html = renderAlertEmail(PAYLOAD);
    expect(html).toContain("PVR Nexus");
    expect(html).toContain("Audi 3");
    expect(html).toContain("IMAX 2D");
    expect(html).toContain("English");
  });

  test("renders one cell per seat, coloured by availability", () => {
    const html = renderAlertEmail(PAYLOAD);
    expect((html.match(/class="seat-cell"/g) || []).length).toBe(3);
    expect(html).toContain("Available");
    expect(html).toContain("Booked");
  });

  test("still renders the availability header when there is no match context", () => {
    const html = renderAlertEmail({ movie: "Alpha", matches: [], seat_layout: SEAT_LAYOUT });
    expect(html).toContain("Seat Availability");
    expect(html).not.toContain("PVR Nexus");
  });

  test("omits the seat map entirely when no layout was fetched", () => {
    const html = renderAlertEmail({ movie: "Alpha", matches: [MATCH], seat_layout: [] });
    expect(html).not.toContain("Seat Availability");
  });

  test("uses the payload booking url for the CTA", () => {
    const html = renderAlertEmail(PAYLOAD);
    expect(html).toContain("https://www.district.in/movies/alpha-movie-tickets-in-pune-MV1");
  });

  test("falls back to the first match's booking url", () => {
    const html = renderAlertEmail({ ...PAYLOAD, booking_url: undefined });
    expect(html).toContain("https://www.district.in/movies/alpha-movie-tickets-in-pune-MV1");
  });
});

describe("renderSatoriSeatMap: telegram image", () => {
  test("renders a single bordered card, so the details are attached to the grid", () => {
    const markup = renderSatoriSeatMap(PAYLOAD);
    expect((markup.match(new RegExp(CARD_BORDER, "g")) || []).length).toBe(1);
  });

  test("puts the seat map header above the availability grid in that one card", () => {
    const markup = renderSatoriSeatMap(PAYLOAD);
    const headerIndex = markup.indexOf("SEAT MAP");
    const venueIndex = markup.indexOf("PVR Nexus");
    const availabilityIndex = markup.indexOf("SEAT AVAILABILITY");
    const areaIndex = markup.indexOf("Executive");

    expect(headerIndex).toBeGreaterThan(-1);
    expect(venueIndex).toBeGreaterThan(headerIndex);
    expect(availabilityIndex).toBeGreaterThan(venueIndex);
    expect(areaIndex).toBeGreaterThan(availabilityIndex);
  });

  test("includes venue, screen and session meta in the image", () => {
    const markup = renderSatoriSeatMap(PAYLOAD);
    expect(markup).toContain("PVR Nexus");
    expect(markup).toContain("Audi 3");
    expect(markup).toContain("IMAX 2D");
    expect(markup).toContain("English");
    expect(markup).toContain("8:00 PM");
  });

  test("returns null when there is no seat layout to draw", () => {
    expect(renderSatoriSeatMap({ movie: "Alpha", matches: [MATCH], seat_layout: [] })).toBeNull();
    expect(renderSatoriSeatMap({ movie: "Alpha", matches: [MATCH] })).toBeNull();
  });
});

describe("renderTelegramCaption", () => {
  test("links to the district booking url from the payload", () => {
    const caption = renderTelegramCaption(PAYLOAD);
    expect(caption).toContain(
      "[Book on District](https://www.district.in/movies/alpha-movie-tickets-in-pune-MV1)"
    );
  });

  test("falls back to the first match's url", () => {
    const caption = renderTelegramCaption({ ...PAYLOAD, booking_url: undefined });
    expect(caption).toContain("alpha-movie-tickets-in-pune-MV1");
  });

  test("groups showtimes by venue", () => {
    const caption = renderTelegramCaption({
      ...PAYLOAD,
      matches: [MATCH, { ...MATCH, showtime: "2026-07-26T18:30:00" }],
    });
    expect(caption.match(/PVR Nexus/g)).toHaveLength(1);
    expect(caption).toContain(", ");
  });

  test("escapes names for legacy Markdown without printing stray backslashes", () => {
    const caption = renderTelegramCaption({
      ...PAYLOAD,
      movie: "Spider-Man: No_Way (2.0)",
      matches: [{ ...MATCH, venue: "INOX - Garuda Mall" }],
    });
    expect(caption).toContain("*Spider-Man: No\\_Way (2.0)*");
    expect(caption).toContain("*INOX - Garuda Mall*");
    expect(caption).not.toContain("\\-");
  });

  test("stays within Telegram's photo caption limit when many venues match", () => {
    const matches = Array.from({ length: 80 }, (_, i) => ({ ...MATCH, venue: `Cinema Number ${i} Mall Road` }));
    const caption = renderTelegramCaption({ ...PAYLOAD, matches });
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption).toMatch(/and \d+ more theatres/);
    expect(caption).toContain("[Book on District]");
  });
});
