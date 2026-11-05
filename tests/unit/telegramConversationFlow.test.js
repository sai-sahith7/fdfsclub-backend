process.env.FRONTEND_URL = "https://fdfsclub.app";

const telegramController = require("../../controllers/telegramController");
const telegramBot = require("../../clients/telegramBot");
const conversation = require("../../services/telegramConversationStore");
const User = require("../../models/User");
const City = require("../../models/City");
const Movie = require("../../models/Movie");
const TelegramConnection = require("../../models/TelegramConnection");

jest.mock("../../clients/telegramBot", () => ({
  sendMessage: jest.fn().mockResolvedValue({ message_id: 123 }),
  editMessageText: jest.fn().mockResolvedValue(true),
  answerCallbackQuery: jest.fn().mockResolvedValue(true),
  deleteMessage: jest.fn().mockResolvedValue(true),
  sendPhoto: jest.fn().mockResolvedValue(true),
}));

jest.mock("../../services/telegramConversationStore", () => ({
  getConversation: jest.fn(),
  setConversation: jest.fn(),
  clearConversation: jest.fn(),
}));

jest.mock("../../models/User", () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock("../../models/City", () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock("../../models/Movie", () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock("../../models/TelegramConnection", () => {
  return class MockConnection {
    static deleteMany = jest.fn();
    static findOne = jest.fn().mockResolvedValue(null);
    constructor(doc) { Object.assign(this, doc); MockConnection.lastCreated = this; }
    save = jest.fn().mockResolvedValue(true);
  };
});

const CHAT_ID = 100;
const MESSAGE_ID = 200;

function lastKeyboard(mock) {
  const call = mock.mock.calls[mock.mock.calls.length - 1];
  const markup = call[1]?.reply_markup ?? call[2]?.reply_markup;
  return (markup?.inline_keyboard ?? []).flat();
}

function lastText(mock) {
  const call = mock.mock.calls[mock.mock.calls.length - 1];
  return call[call.length - 2] ?? call[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  User.findOne.mockResolvedValue(null);
  City.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
  City.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
  Movie.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
  const movieQuery = {
    select: jest.fn(() => movieQuery),
    sort: jest.fn(() => movieQuery),
    lean: jest.fn().mockResolvedValue([]),
  };
  Movie.find.mockReturnValue(movieQuery);
  conversation.getConversation.mockResolvedValue(null);
});

describe("/start: verification code message", () => {
  test("shows the code and a one-tap link that carries it", async () => {
    await telegramController.handleMessage({
      chat: { id: CHAT_ID },
      text: "/start",
      from: { username: "movienerd" },
    });

    expect(telegramBot.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, options] = telegramBot.sendMessage.mock.calls[0];
    const code = TelegramConnection.lastCreated.code;

    expect(chatId).toBe(CHAT_ID);
    expect(code).toMatch(/^\d{6}$/);
    expect(text).toContain(`\`${code}\``);
    expect(text).toContain(`https://fdfsclub.app/telegram?code=${code}`);
    expect(options.disable_web_page_preview).toBe(true);
  });

  test("persists the code against the chat so verification can find it", async () => {
    await telegramController.handleMessage({
      chat: { id: CHAT_ID },
      text: "/start",
      from: { username: "movienerd" },
    });

    const saved = TelegramConnection.lastCreated;
    expect(saved.chat_id).toBe(String(CHAT_ID));
    expect(saved.telegram_handle).toBe("movienerd");
    expect(saved.status).toBe("PENDING");
    expect(saved.expires_at.getTime()).toBeGreaterThan(Date.now());
    expect(saved.save).toHaveBeenCalled();
  });

  test("tells an already-linked user instead of issuing a new code", async () => {
    User.findOne.mockResolvedValue({ email: "test@example.com" });

    await telegramController.handleMessage({
      chat: { id: CHAT_ID },
      text: "/start",
      from: { username: "movienerd" },
    });

    expect(telegramBot.sendMessage.mock.calls[0][1]).toContain("already linked");
  });
});

describe("city step: favourite city", () => {
  const CITIES = [
    { name: "Bengaluru", slug: "bengaluru" },
    { name: "Mumbai", slug: "mumbai" },
    { name: "Hyderabad", slug: "hyderabad" },
  ];

  beforeEach(() => {
    City.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(CITIES) });
    conversation.getConversation.mockResolvedValue({ step: "movie", data: {} });
  });

  test("puts the favourite city first and marks it", async () => {
    User.findOne.mockResolvedValue({
      email: "test@example.com",
      favourite_city: { name: "Hyderabad", slug: "hyderabad" },
    });

    await telegramController.handleCallbackQuery({
      id: "cq", message: { chat: { id: CHAT_ID }, message_id: MESSAGE_ID }, data: "back:city",
    });

    const buttons = lastKeyboard(telegramBot.editMessageText);
    expect(buttons[0]).toEqual({ text: "⭐ Hyderabad", callback_data: "city:hyderabad" });
    expect(lastText(telegramBot.editMessageText)).toContain("favourite city");
  });

  test("keeps the famous-city order when no favourite is set", async () => {
    User.findOne.mockResolvedValue({ email: "test@example.com" });

    await telegramController.handleCallbackQuery({
      id: "cq", message: { chat: { id: CHAT_ID }, message_id: MESSAGE_ID }, data: "back:city",
    });

    const buttons = lastKeyboard(telegramBot.editMessageText);
    expect(buttons[0].callback_data).toBe("city:bengaluru");
    expect(buttons.some((button) => button.text.includes("⭐"))).toBe(false);
  });

  test("still lists every city, favourite included exactly once", async () => {
    User.findOne.mockResolvedValue({
      email: "test@example.com",
      favourite_city: { name: "Hyderabad", slug: "hyderabad" },
    });

    await telegramController.handleCallbackQuery({
      id: "cq", message: { chat: { id: CHAT_ID }, message_id: MESSAGE_ID }, data: "back:city",
    });

    const cityButtons = lastKeyboard(telegramBot.editMessageText)
      .filter((button) => button.callback_data.startsWith("city:"));
    expect(cityButtons).toHaveLength(3);
    expect(cityButtons.filter((b) => b.callback_data === "city:hyderabad")).toHaveLength(1);
  });
});

describe("date step: release-date window", () => {
  function isoDaysFromToday(offset) {
    const now = new Date();
    const today = new Date(now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
    return new Date(today.getTime() + offset * 86400000).toISOString().split("T")[0];
  }

  async function openDateStep(movie) {
    conversation.getConversation.mockResolvedValue({ step: "date", data: { movie } });
    await telegramController.handleCallbackQuery({
      id: "cq", message: { chat: { id: CHAT_ID }, message_id: MESSAGE_ID }, data: "back:date",
    });
    return lastKeyboard(telegramBot.editMessageText)
      .filter((button) => button.callback_data.startsWith("date:"))
      .map((button) => button.callback_data.replace("date:", ""));
  }

  test("offers 11 days starting today for a released movie", async () => {
    const dates = await openDateStep({ id: 1, name: "Alpha", release_date: "2020-01-01" });

    expect(dates).toHaveLength(11);
    expect(dates[0]).toBe(isoDaysFromToday(0));
    expect(dates[10]).toBe(isoDaysFromToday(10));
  });

  test("starts at the release date for an unreleased movie", async () => {
    const releaseDate = isoDaysFromToday(20);
    const dates = await openDateStep({ id: 1, name: "Alpha", release_date: releaseDate });

    expect(dates[0]).toBe(releaseDate);
    expect(dates).toHaveLength(11);
    expect(dates).not.toContain(isoDaysFromToday(0));
  });

  test("says why the dates start later for an unreleased movie", async () => {
    await openDateStep({ id: 1, name: "Alpha", release_date: isoDaysFromToday(20) });
    expect(lastText(telegramBot.editMessageText)).toContain("releases on");
  });

  test("falls back to today when the movie has no release date", async () => {
    const dates = await openDateStep({ id: 1, name: "Alpha" });
    expect(dates[0]).toBe(isoDaysFromToday(0));
  });
});

describe("movie step: captures filter metadata", () => {
  test("stores release date, languages and formats on selection", async () => {
    conversation.getConversation.mockResolvedValue({ step: "movie", data: {} });
    Movie.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        contentId: 555,
        name: "Alpha",
        image_url: "poster.jpg",
        release_date: "2026-08-01",
        extras: {
          language_variants: ["Telugu", "TELUGU", "English"],
          screen_formats: ["IMAX", "imax", "2D"],
        },
      }),
    });

    await telegramController.handleCallbackQuery({
      id: "cq", message: { chat: { id: CHAT_ID }, message_id: MESSAGE_ID }, data: "movie:555",
    });

    const [, state] = conversation.setConversation.mock.calls[0];
    expect(state.data.movie).toEqual({
      id: 555,
      name: "Alpha",
      image_url: "poster.jpg",
      release_date: "2026-08-01",
      languages: ["Telugu", "English"],
      screen_formats: ["IMAX", "2D"],
    });
  });
});

describe("filter step: only this movie's options", () => {
  const MOVIE = {
    id: 1,
    name: "Alpha",
    languages: ["Telugu", "English"],
    screen_formats: ["IMAX", "2D"],
  };

  async function expandFilter(filterKey, movie) {
    conversation.getConversation.mockResolvedValue({
      step: "filters",
      data: { movie, filters: { language: "Any", format: "Any", price: "Any" } },
    });
    await telegramController.handleCallbackQuery({
      id: "cq",
      message: { chat: { id: CHAT_ID }, message_id: MESSAGE_ID },
      data: `filter_expand:${filterKey}`,
    });
    return lastKeyboard(telegramBot.editMessageText)
      .filter((button) => button.callback_data.startsWith("filter_set:"))
      .map((button) => button.text.replace("✓ ", ""));
  }

  test("offers only the languages the movie plays in, plus Any", async () => {
    expect(await expandFilter("language", MOVIE)).toEqual(["Any", "Telugu", "English"]);
  });

  test("offers only the formats the movie plays in, plus Any", async () => {
    expect(await expandFilter("format", MOVIE)).toEqual(["Any", "IMAX", "2D"]);
  });

  test("does not offer languages the movie is not screened in", async () => {
    const options = await expandFilter("language", MOVIE);
    expect(options).not.toContain("Kannada");
    expect(options).not.toContain("Malayalam");
  });

  test("collapses casing duplicates from the catalogue", async () => {
    const options = await expandFilter("language", {
      ...MOVIE,
      languages: ["Telugu", "TELUGU", "telugu"],
    });
    expect(options).toEqual(["Any", "Telugu"]);
  });

  test("falls back to the standard list when the movie has no catalogue data", async () => {
    const options = await expandFilter("language", { id: 1, name: "Alpha" });
    expect(options).toEqual(["Any", "English", "Hindi", "Telugu", "Tamil", "Kannada", "Malayalam"]);
  });

  test("price options are a fixed ladder, not movie-derived", async () => {
    conversation.getConversation.mockResolvedValue({
      step: "filters",
      data: { movie: MOVIE, filters: { language: "Any", format: "Any", price: "Any" } },
    });
    await telegramController.handleCallbackQuery({
      id: "cq",
      message: { chat: { id: CHAT_ID }, message_id: MESSAGE_ID },
      data: "filter_expand:price",
    });

    const options = lastKeyboard(telegramBot.editMessageText)
      .filter((button) => button.callback_data.startsWith("filter_set:"))
      .map((button) => button.text.replace("✓ ", ""));
    expect(options).toEqual(["Any", "₹200", "₹300", "₹500", "₹1000", "₹2000"]);
  });

  test("cycling a filter walks the movie's own options", async () => {
    conversation.getConversation.mockResolvedValue({
      step: "filters",
      data: { movie: MOVIE, filters: { language: "Any", format: "Any", price: "Any" } },
    });

    await telegramController.handleCallbackQuery({
      id: "cq",
      message: { chat: { id: CHAT_ID }, message_id: MESSAGE_ID },
      data: "filter_toggle:language",
    });

    const [, state] = conversation.setConversation.mock.calls[0];
    expect(state.data.filters.language).toBe("Telugu");
  });
});
