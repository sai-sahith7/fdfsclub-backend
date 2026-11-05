const { renderTelegramCaption } = require("../../renderers/telegramTemplate");
const { renderAlertEmail } = require("../../renderers/emailTemplate");

const BMS_URL = "https://in.bookmyshow.com/cinemas/hyderabad/prasads-multiplex-hyderabad/buytickets/PRHN/20260928";
const districtMatch = {
  venue: "INOX Kachiguda", showtime: "2026-09-28T12:00", screen: "SCREEN 3", screen_format: "2D",
  language: "Telugu", seats_available: 40, price: 200, source: "district", booking_url: "https://www.district.in/movies/x-MV1",
};
const bmsMatch = {
  venue: "Prasads Multiplex: Hyderabad", showtime: "2026-09-28T13:35", screen: "SCREEN 6", screen_format: "2D",
  language: "Telugu", seats_available: null, price: 390, source: "bookmyshow", booking_url: BMS_URL,
};

describe("telegram caption", () => {
  test("mixed matches keep District as the main link and link BookMyShow venues separately", () => {
    const caption = renderTelegramCaption({ movie: "The Paradise", matches: [districtMatch, bmsMatch], booking_url: districtMatch.booking_url });
    expect(caption).toContain(`[Book on BookMyShow](${BMS_URL})`);
    expect(caption).toContain("[Book on District](https://www.district.in/movies/x-MV1)");
  });

  test("BookMyShow-only matches point the main link at BookMyShow", () => {
    const caption = renderTelegramCaption({ movie: "The Paradise", matches: [bmsMatch], booking_url: BMS_URL });
    expect(caption).toContain(`[Book on BookMyShow](${BMS_URL})`);
    expect(caption).not.toContain("District");
  });
});

describe("email", () => {
  test("BookMyShow venues show a BookMyShow link instead of an unknown seat count", () => {
    const html = renderAlertEmail({ movie: "The Paradise", matches: [districtMatch, bmsMatch], seat_layout: [], booking_url: districtMatch.booking_url });
    expect(html).not.toMatch(/null seats/);
    expect(html).toContain("40 seats");
    expect(html).toContain(`href="${BMS_URL}"`);
    expect(html).toContain("BookMyShow");
  });
});
