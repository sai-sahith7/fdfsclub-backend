const crypto = require("crypto");
const User = require("../models/User");
const Alert = require("../models/Alert");
const City = require("../models/City");
const Movie = require("../models/Movie");
const Venue = require("../models/Venue");
const TelegramConnection = require("../models/TelegramConnection");
const telegramBot = require("../clients/telegramBot");
const conversation = require("./telegramConversationStore");
const districtClient = require("../clients/districtClient");
const movieCatalogService = require("./movieCatalogService");
const { upsertSearchedMovie } = require("./movieSearchService");
const { findActiveMovies } = require("./movieQueries");
const { createAlertForUser } = require("./alertService");
const { escapeMarkdown } = require("../utils/telegramMarkdown");
const logger = require("../utils/logger");
const { fuzzySearchMovies, fuzzySearchByName } = require("../utils/fuzzySearch");
const { dedupeIgnoreCase } = require("../utils/normalize");
const { getAlertDateOptions } = require("../utils/dateOptions");
const { buildTelegramLinkUrl } = require("../utils/appLinks");
const {
  APP_NAME,
  FAMOUS_CITIES,
  MAX_ACTIVE_ALERTS_PER_USER,
  LANGUAGE_FILTER_OPTIONS,
  FORMAT_FILTER_OPTIONS,
  PRICE_FILTER_OPTIONS,
  TELEGRAM_CODE_TTL_MINUTES,
} = require("../constants/appConstants");

const MOVIE_PAGE_SIZE = 8;
const VENUE_PAGE_SIZE = 10;
const CALLBACK_DATA_LIMIT = 64;

const TAG = "TelegramConversationService";

const BACK_CANCEL = (back) => [{ text: "« Back", callback_data: back }, { text: "Cancel", callback_data: "cancel_flow" }];

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();

  if (text.startsWith("/")) {
    const command = text.split(" ")[0].split("@")[0].toLowerCase();
    const commandArgs = text.slice(text.split(" ")[0].length).trim();
    switch (command) {
      case "/start": return handleStart(chatId, message);
      case "/new": return handleNewAlert(chatId, message);
      case "/search": return handleQuickSearch(chatId, commandArgs);
      case "/alerts":
      case "/myalerts": return handleListAlerts(chatId, message);
      case "/unlink": return handleUnlink(chatId, message);
      case "/help": return handleHelp(chatId);
      default: return telegramBot.sendMessage(chatId, "I don't know that command. Send /help to see what I can do.");
    }
  }

  const conversationData = await conversation.getConversation(chatId);
  if (conversationData && text) {
    const query = text.slice(0, 100);
    if (conversationData.step === "movie_search") {
      await telegramBot.deleteMessage(chatId, message.message_id).catch(() => {});
      return handleMovieSearch(chatId, query, conversationData.data.lastMessageId);
    } else if (conversationData.step === "venue_search_prompt") {
      await telegramBot.deleteMessage(chatId, message.message_id).catch(() => {});
      return handleVenueSearch(chatId, query, conversationData.data.lastMessageId);
    }
  }

  return telegramBot.sendMessage(chatId, "Send /new to set up a ticket alert, or /help to see everything I can do.");
}

async function handleStart(chatId, message) {
  const username = message.from?.username || message.from?.first_name || "Telegram user";
  const existingUser = await User.findOne({ "telegram.chat_id": String(chatId), "telegram.connected": true });

  if (existingUser) {
    return telegramBot.sendMessage(
      chatId,
      `This chat is already linked to *${escapeMarkdown(existingUser.email)}*.\n\n` +
      `Send /new to create an alert, or /alerts to see the ones you have.`
    );
  }

  await TelegramConnection.deleteMany({ chat_id: String(chatId), status: "PENDING" });
  let code, isUnique = false, attempts = 0;
  while (!isUnique && attempts < 10) {
    code = crypto.randomInt(100000, 1000000).toString();
    const existing = await TelegramConnection.findOne({ code, status: "PENDING" });
    if (!existing) isUnique = true;
    attempts++;
  }

  if (!isUnique) return telegramBot.sendMessage(chatId, "Sorry, I couldn't create a code just now. Please send /start again.");

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + TELEGRAM_CODE_TTL_MINUTES);

  await new TelegramConnection({
    code, telegram_handle: username, chat_id: String(chatId), expires_at: expiresAt, status: "PENDING"
  }).save();

  const linkUrl = buildTelegramLinkUrl(code);

  return telegramBot.sendMessage(chatId,
    `*Link your ${escapeMarkdown(APP_NAME)} account*\n\n` +
    `Your code is:\n\`${code}\`\n\n` +
    `[Tap here to link your account](${linkUrl})\n\n` +
    `This opens ${escapeMarkdown(APP_NAME)} with the code already filled in. ` +
    `You can also type it on the Telegram page of the website.\n\n` +
    `The code works for ${TELEGRAM_CODE_TTL_MINUTES} minutes.`,
    { disable_web_page_preview: true }
  );
}

async function handleHelp(chatId) {
  return telegramBot.sendMessage(chatId,
    `*${escapeMarkdown(APP_NAME)} bot*\n\n` +
    `I message you when tickets open for the shows you're waiting for.\n\n` +
    `/new - set up a ticket alert\n` +
    `/search - find a movie\n` +
    `/alerts - see or cancel your alerts\n` +
    `/start - link this chat to your account\n` +
    `/unlink - stop alerts on Telegram\n` +
    `/help - show this message`
  );
}

async function handleUnlink(chatId) {
  const user = await User.findOne({ "telegram.chat_id": String(chatId), "telegram.connected": true });
  if (!user) return telegramBot.sendMessage(chatId, `This chat isn't linked to a ${escapeMarkdown(APP_NAME)} account.`);

  await User.findOneAndUpdate({ _id: user._id }, { $set: { "telegram.chat_id": null, "telegram.username": null, "telegram.connected": false } });
  return telegramBot.sendMessage(
    chatId,
    "Done. You won't get alerts here any more, but they'll still arrive by email.\n\nSend /start whenever you want to link again."
  );
}

function formatDay(date, options = { day: "numeric", month: "short" }) {
  return new Date(date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", ...options });
}

async function handleListAlerts(chatId) {
  const user = await findLinkedUser(chatId);
  if (!user) return promptLink(chatId);

  const alerts = await Alert.find({ user_email: user.email, status: "ACTIVE" }).sort({ created_at: -1 }).limit(10);
  if (alerts.length === 0) return telegramBot.sendMessage(chatId, "You don't have any active alerts.\nSend /new to create one.");

  let text = "*Your active alerts*\n\n";
  const buttons = [];
  for (const alert of alerts) {
    text += `*${escapeMarkdown(alert.movie.name)}*\n${escapeMarkdown(alert.city.name)} · ${formatDay(alert.alert_date, { weekday: "short", day: "numeric", month: "short" })}\n\n`;
    buttons.push([{ text: `Cancel: ${truncate(alert.movie.name, 25)}`, callback_data: `cancel_alert:${alert._id}` }]);
  }
  text += "Tap an alert below to cancel it.";
  return telegramBot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: buttons } });
}

async function handleNewAlert(chatId) {
  const user = await findLinkedUser(chatId);
  if (!user) return promptLink(chatId);

  const activeCount = await Alert.countDocuments({ user_email: user.email, status: "ACTIVE" });
  if (activeCount >= MAX_ACTIVE_ALERTS_PER_USER) {
    return telegramBot.sendMessage(
      chatId,
      `You already have ${MAX_ACTIVE_ALERTS_PER_USER} active alerts, which is the limit.\n\n` +
      "Send /alerts to cancel one you no longer need, then send /new again."
    );
  }

  await conversation.setConversation(chatId, { step: "city", data: { user_email: user.email } });
  return showCitySelection(chatId);
}

async function sendOrEdit(chatId, messageId, text, replyMarkup) {
  if (messageId) {
    return telegramBot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: replyMarkup });
  } else {
    const sentMessage = await telegramBot.sendMessage(chatId, text, { reply_markup: replyMarkup });
    const conversationData = await conversation.getConversation(chatId);
    if (conversationData && sentMessage) {
      await conversation.setConversation(chatId, { ...conversationData, data: { ...conversationData.data, lastMessageId: sentMessage.message_id } });
    }
    return sentMessage;
  }
}

async function showCitySelection(chatId, messageId = null) {
  const cities = await City.find({ is_active: true }).lean();
  const favouriteSlug = await getFavouriteCitySlug(chatId);

  cities.sort((cityA, cityB) => {
    if (favouriteSlug) {
      if (cityA.slug === favouriteSlug) return -1;
      if (cityB.slug === favouriteSlug) return 1;
    }
    const aIndex = FAMOUS_CITIES.indexOf(cityA.slug);
    const bIndex = FAMOUS_CITIES.indexOf(cityB.slug);
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return cityA.name.localeCompare(cityB.name);
  });

  const display = cities.slice(0, 12);
  const label = (city) => (city.slug === favouriteSlug ? `⭐ ${city.name}` : city.name);

  const buttons = [];
  for (let i = 0; i < display.length; i += 2) {
    const row = [{ text: label(display[i]), callback_data: `city:${display[i].slug}` }];
    if (display[i + 1]) row.push({ text: label(display[i + 1]), callback_data: `city:${display[i + 1].slug}` });
    buttons.push(row);
  }
  buttons.push([{ text: "Cancel", callback_data: "cancel_flow" }]);

  const prompt = favouriteSlug
    ? "*Pick a city*\n\nYour favourite city is marked with ⭐."
    : "*Pick a city*\n\nWhere do you want to watch?";

  return sendOrEdit(chatId, messageId, prompt, { inline_keyboard: buttons });
}

async function getFavouriteCitySlug(chatId) {
  const user = await findLinkedUser(chatId);
  return user?.favourite_city?.slug || null;
}

async function showMovieSelection(chatId, messageId = null) {
  const conversationData = await conversation.getConversation(chatId);
  const allMovies = await findActiveMovies();

  const total = allMovies.length;
  const totalPages = Math.max(1, Math.ceil(total / MOVIE_PAGE_SIZE));
  const page = Math.min(Math.max(conversationData?.data?.moviePage || 0, 0), totalPages - 1);
  const start = page * MOVIE_PAGE_SIZE;
  const pageMovies = allMovies.slice(start, start + MOVIE_PAGE_SIZE);

  const buttons = [];
  buttons.push([{ text: "🔍 Search by name", callback_data: "movie:search" }]);

  for (const movie of pageMovies) {
    buttons.push([{ text: movie.name, callback_data: `movie:${movie.contentId}` }]);
  }

  const navigationRow = [];
  if (page > 0) navigationRow.push({ text: "« Prev", callback_data: `movie_page:${page - 1}` });
  if (start + MOVIE_PAGE_SIZE < total) navigationRow.push({ text: "Next »", callback_data: `movie_page:${page + 1}` });
  if (navigationRow.length > 0) buttons.push(navigationRow);

  buttons.push(BACK_CANCEL("back:city"));

  const text = total === 0
    ? "*Pick a movie*\n\nTap Search and type the movie's name."
    : `*Pick a movie*\n\nPage ${page + 1} of ${totalPages}. Can't see yours? Tap Search.`;
  return sendOrEdit(chatId, messageId, text, { inline_keyboard: buttons });
}

async function handleMovieSearch(chatId, query, messageId = null) {
  const allMovies = await findActiveMovies();
  const fuzzyResults = fuzzySearchMovies(allMovies, query).slice(0, 8);
  const buttons = fuzzyResults.map((movie) => [{ text: movie.name, callback_data: `movie:${movie.contentId}` }]);

  const conversationData = await conversation.getConversation(chatId);
  if (!conversationData) return promptRestart(chatId, messageId);
  await conversation.setConversation(chatId, { ...conversationData, step: "movie", data: { ...conversationData.data, searchQuery: query } });

  buttons.push([{ text: fuzzyResults.length === 0 ? "🔎 Search all movies" : "Not here? Search all movies", callback_data: "search_district" }]);
  buttons.push(BACK_CANCEL("back:movie"));

  const text = fuzzyResults.length === 0
    ? `I couldn't find "${escapeMarkdown(query)}" in the current list. Tap below to look further.`
    : `Here's what I found for "${escapeMarkdown(query)}":`;
  return sendOrEdit(chatId, messageId, text, { inline_keyboard: buttons });
}

async function handleDistrictMovieSearch(chatId, messageId = null) {
  const conversationData = await conversation.getConversation(chatId);
  if (!conversationData?.data?.searchQuery) return promptRestart(chatId, messageId);
  const query = conversationData.data.searchQuery;
  const city = await City.findOne({ slug: conversationData.data.city?.slug }).lean();

  try {
    const lat = city?.latitude ?? 12.9716;
    const lng = city?.longitude ?? 77.5946;
    const location = await districtClient.resolveLocation(lat, lng);
    const searchResponse = await districtClient.search(query, "movies", location);
    const results = (searchResponse.results || []).filter((result) => result.entityType === "EntityTypeMovie" && result.id);

    if (results.length === 0) {
      return sendOrEdit(chatId, messageId, `I couldn't find a movie called "${escapeMarkdown(query)}". Check the spelling and try again.`, {
        inline_keyboard: [BACK_CANCEL("back:movie")]
      });
    }

    const buttons = results.slice(0, 8).map(result => [{ text: result.displayTitle, callback_data: `d_movie:${result.id}` }]);
    buttons.push(BACK_CANCEL("back:movie"));

    const districtMovies = results.slice(0, 8).reduce((accumulator, result) => {
      accumulator[result.id] = result;
      return accumulator;
    }, {});
    await conversation.setConversation(chatId, { ...conversationData, data: { ...conversationData.data, districtMovies } });

    return sendOrEdit(chatId, messageId, "Which one did you mean?", { inline_keyboard: buttons });
  } catch (error) {
    logger.error(TAG, "Movie search failed", error.message);
    return sendOrEdit(chatId, messageId, "Sorry, search isn't working right now. Please try again in a bit.", {
      inline_keyboard: [[{ text: "« Back", callback_data: "back:movie" }]]
    });
  }
}

async function showDateSelection(chatId, messageId = null) {
  const conversationData = await conversation.getConversation(chatId);
  const releaseDate = conversationData?.data?.movie?.release_date || null;

  const options = getAlertDateOptions({ releaseDate });

  const buttons = [];
  for (let i = 0; i < options.length; i += 2) {
    const row = [{ text: options[i].label, callback_data: `date:${options[i].iso}` }];
    if (options[i + 1]) row.push({ text: options[i + 1].label, callback_data: `date:${options[i + 1].iso}` });
    buttons.push(row);
  }
  buttons.push(BACK_CANCEL("back:movie"));

  const releasesLater = releaseDate && options[0].iso === String(releaseDate).slice(0, 10);
  const prompt = releasesLater
    ? `*Pick a date*\n\nThis movie releases on ${options[0].label}, so dates start there.`
    : "*Pick a date*\n\nWhich day do you want to watch?";

  return sendOrEdit(chatId, messageId, prompt, { inline_keyboard: buttons });
}

async function showVenueSelection(chatId, messageId = null) {
  const conversationData = await conversation.getConversation(chatId);
  if (!conversationData) return promptRestart(chatId, messageId);

  const cityName = conversationData.data.city?.name;
  const page = conversationData.data.venuePage || 0;
  const venueQuery = conversationData.data.venueQuery || "";

  let venues;
  let total;

  if (venueQuery) {
    const allCityVenues = await Venue.find({ city_name: cityName }).select("name").sort({ name: 1 }).lean();
    const fuzzyResults = fuzzySearchByName(allCityVenues, venueQuery);
    total = fuzzyResults.length;
    venues = fuzzyResults.slice(page * VENUE_PAGE_SIZE, (page * VENUE_PAGE_SIZE) + VENUE_PAGE_SIZE);
  } else {
    const skip = page * VENUE_PAGE_SIZE;
    venues = await Venue.find({ city_name: cityName }).select("name").sort({ name: 1 }).skip(skip).limit(VENUE_PAGE_SIZE).lean();
    total = await Venue.countDocuments({ city_name: cityName });
  }

  const selectedIds = (conversationData.data.venues || []).map((venue) => venue.id);

  const buttons = [];
  if (!venueQuery) {
    buttons.push([{ text: "🔍 Search theatres", callback_data: "venue_search_prompt" }]);
  } else {
    buttons.push([{ text: "✕ Clear search", callback_data: "venue_search_clear" }]);
  }
  buttons.push([{ text: "Any theatre", callback_data: "venue:any" }]);

  for (const venue of venues) {
    const isSelected = selectedIds.includes(venue._id);
    buttons.push([{ text: `${isSelected ? "☑" : "☐"} ${venue.name}`, callback_data: `venue:${venue._id}` }]);
  }

  const navigationRow = [];
  if (page > 0) navigationRow.push({ text: "« Prev", callback_data: `venue_page:${page - 1}` });
  if ((page * VENUE_PAGE_SIZE) + VENUE_PAGE_SIZE < total) navigationRow.push({ text: "Next »", callback_data: `venue_page:${page + 1}` });
  if (navigationRow.length > 0) buttons.push(navigationRow);

  if (selectedIds.length > 0) buttons.push([{ text: `✓ Done (${selectedIds.length} selected)`, callback_data: "venue:done" }]);
  buttons.push(BACK_CANCEL("back:date"));

  const pageInfo = total > VENUE_PAGE_SIZE ? ` (${page * VENUE_PAGE_SIZE + 1}-${Math.min((page + 1) * VENUE_PAGE_SIZE, total)} of ${total})` : "";
  let text = `*Pick theatres*${pageInfo}\n\n`;
  if (venueQuery && total === 0) {
    text += `No theatres match "${escapeMarkdown(venueQuery)}". Try another name, or pick Any theatre.`;
  } else if (!venueQuery && total === 0) {
    text += "We're still loading theatres for this city. Pick Any theatre to include them all.";
  } else {
    text += "Tap theatres to select them, then tap Done. Or pick Any theatre.";
  }
  return sendOrEdit(chatId, messageId, text, { inline_keyboard: buttons });
}

async function handleVenueSearch(chatId, query, messageId = null) {
  const conversationData = await conversation.getConversation(chatId);
  if (!conversationData) return promptRestart(chatId, messageId);
  await conversation.setConversation(chatId, { ...conversationData, step: "venues", data: { ...conversationData.data, venueQuery: query, venuePage: 0 } });
  return showVenueSelection(chatId, messageId);
}

function priceLabel(value) {
  return value === "Any" ? "Any" : `₹${value}`;
}

async function showFilterOptions(chatId, messageId = null) {
  const conversationData = await conversation.getConversation(chatId);
  if (!conversationData) return promptRestart(chatId, messageId);
  const filters = conversationData.data.filters || { language: "Any", format: "Any", price: "Any" };
  await conversation.setConversation(chatId, { ...conversationData, data: { ...conversationData.data, filters } });

  const buttons = [];

  buttons.push([{ text: `🗣 Language: ${filters.language}`, callback_data: "filter_expand:language" }]);
  buttons.push([{ text: `🎬 Format: ${filters.format}`, callback_data: "filter_expand:format" }]);
  buttons.push([{ text: `💰 Max price: ${priceLabel(filters.price)}`, callback_data: "filter_expand:price" }]);

  buttons.push([{ text: "✓ Continue", callback_data: "filter:apply" }]);
  buttons.push(BACK_CANCEL("back:venues"));
  return sendOrEdit(chatId, messageId, "*Filters (optional)*\n\nTap one to change it, or tap Continue.", { inline_keyboard: buttons });
}

function getFilterOptions(filterKey, data = {}) {
  if (filterKey === "language") {
    const available = dedupeIgnoreCase(data.movie?.languages || []);
    return {
      label: "🗣 Language",
      options: available.length > 0 ? ["Any", ...available] : dedupeIgnoreCase(LANGUAGE_FILTER_OPTIONS),
    };
  }

  if (filterKey === "format") {
    const available = dedupeIgnoreCase(data.movie?.screen_formats || []);
    return {
      label: "🎬 Format",
      options: available.length > 0 ? ["Any", ...available] : dedupeIgnoreCase(FORMAT_FILTER_OPTIONS),
    };
  }

  return { label: "💰 Max price", options: PRICE_FILTER_OPTIONS };
}

async function showFilterExpanded(chatId, filterKey, messageId = null) {
  const conversationData = await conversation.getConversation(chatId);
  if (!conversationData) return promptRestart(chatId, messageId);
  if (!["language", "format", "price"].includes(filterKey)) return showFilterOptions(chatId, messageId);
  const filters = conversationData.data.filters || { language: "Any", format: "Any", price: "Any" };

  const { options, label } = getFilterOptions(filterKey, conversationData.data);

  const buttons = [];
  const optionRow = [];
  for (const option of options) {
    const callbackData = `filter_set:${filterKey}:${option}`;
    if (Buffer.byteLength(callbackData) > CALLBACK_DATA_LIMIT) continue;
    const isActive = filters[filterKey] === option;
    const text = filterKey === "price" ? priceLabel(option) : option;
    optionRow.push({ text: `${isActive ? "✓ " : ""}${text}`, callback_data: callbackData });
    if (optionRow.length === 3) {
      buttons.push([...optionRow]);
      optionRow.length = 0;
    }
  }
  if (optionRow.length > 0) buttons.push([...optionRow]);

  buttons.push([{ text: "« Back to filters", callback_data: "back:filters_main" }]);

  return sendOrEdit(chatId, messageId, `*${label}*\n\nPick one:`, { inline_keyboard: buttons });
}

async function showConfirmation(chatId, messageId = null) {
  const conversationData = await conversation.getConversation(chatId);
  if (!conversationData) return promptRestart(chatId, messageId);

  const data = conversationData.data;
  const dateStr = formatDay(data.alert_date, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const venueStr = data.venues && data.venues.length > 0 ? data.venues.map((venue) => venue.name).join(", ") : "Any theatre";

  let text = "*Check your alert*\n\n";
  text += `Movie: ${escapeMarkdown(data.movie?.name || "")}\nCity: ${escapeMarkdown(data.city?.name || "")}\nDate: ${dateStr}\nTheatres: ${escapeMarkdown(venueStr)}\n`;

  if (data.filters && (data.filters.language !== "Any" || data.filters.format !== "Any" || data.filters.price !== "Any")) {
    if (data.filters.language !== "Any") text += `Language: ${escapeMarkdown(data.filters.language)}\n`;
    if (data.filters.format !== "Any") text += `Format: ${escapeMarkdown(data.filters.format)}\n`;
    if (data.filters.price !== "Any") text += `Max price: ₹${escapeMarkdown(data.filters.price)}\n`;
  }
  text += "\nCreate this alert?";

  const buttons = [
    [{ text: "✓ Create alert", callback_data: "confirm:yes" }],
    [
      { text: "« Back", callback_data: "back:filters" },
      { text: "Cancel", callback_data: "confirm:no" }
    ],
  ];
  return sendOrEdit(chatId, messageId, text, { inline_keyboard: buttons });
}

async function createAlertFromConversation(chatId, messageId) {
  const conversationData = await conversation.getConversation(chatId);
  if (!conversationData) return promptRestart(chatId, messageId);
  const data = conversationData.data;

  const filters = {};
  if (data.filters) {
    if (data.filters.language && data.filters.language !== "Any") filters.languages = [data.filters.language];
    if (data.filters.format && data.filters.format !== "Any") filters.formats = [data.filters.format];
    if (data.filters.price && data.filters.price !== "Any") filters.price_max = parseInt(data.filters.price, 10);
  }

  try {
    const alert = await createAlertForUser(data.user_email, {
      movieId: data.movie?.id,
      city: data.city?.name || data.city?.slug,
      venueIds: (data.venues || []).map((venue) => venue.id),
      alertDate: data.alert_date,
      filters,
    });
    await conversation.clearConversation(chatId);

    return sendOrEdit(chatId, messageId,
      `*Alert created!*\n\n${escapeMarkdown(alert.movie.name)}\n${escapeMarkdown(alert.city.name)} · ${formatDay(alert.alert_date, { weekday: "short", day: "numeric", month: "short" })}\n\n` +
      `I'll message you when tickets open.`, null
    );
  } catch (error) {
    await conversation.clearConversation(chatId);
    if (error.expose) {
      return sendOrEdit(chatId, messageId, `${escapeMarkdown(error.message)}\n\nSend /new to start again.`, null);
    }
    logger.error(TAG, "Failed to create alert", error.message);
    return sendOrEdit(chatId, messageId, "Sorry, something went wrong creating your alert. Please send /new to try again.", null);
  }
}

async function handleCallbackQuery(query) {
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const data = typeof query.data === "string" ? query.data : "";

  await telegramBot.answerCallbackQuery(query.id);
  if (chatId == null || !data) return;

  if (data === "cancel_flow" || data === "confirm:no") {
    await conversation.clearConversation(chatId);
    return telegramBot.editMessageText("Okay, cancelled. Send /new whenever you want to start again.", { chat_id: chatId, message_id: messageId });
  }

  if (data.startsWith("back:")) {
    const target = data.replace("back:", "");
    const conversationData = await conversation.getConversation(chatId);
    if (!conversationData) return promptRestart(chatId, messageId);
    await conversation.setConversation(chatId, { ...conversationData, step: target });

    if (target === "city") return showCitySelection(chatId, messageId);
    if (target === "movie") return showMovieSelection(chatId, messageId);
    if (target === "date") return showDateSelection(chatId, messageId);
    if (target === "venues") return showVenueSelection(chatId, messageId);
    if (target === "filters") return showFilterOptions(chatId, messageId);
    if (target === "filters_main") return showFilterOptions(chatId, messageId);
    return;
  }

  if (data.startsWith("movie_page:")) {
    const page = parseInt(data.replace("movie_page:", ""), 10) || 0;
    const conversationData = await conversation.getConversation(chatId);
    if (!conversationData) return promptRestart(chatId, messageId);
    await conversation.setConversation(chatId, { ...conversationData, data: { ...conversationData.data, moviePage: page } });
    return showMovieSelection(chatId, messageId);
  }

  if (data.startsWith("city:")) {
    const slug = data.replace("city:", "");
    const city = await City.findOne({ slug }).lean();
    if (!city) return sendOrEdit(chatId, messageId, "That city isn't available any more. Send /new to start again.", null);

    const conversationData = await conversation.getConversation(chatId);
    if (!conversationData) return promptRestart(chatId, messageId);
    await conversation.setConversation(chatId, { ...conversationData, step: "movie", data: { ...conversationData.data, city: { name: city.name, slug: city.slug }, moviePage: 0 } });
    return showMovieSelection(chatId, messageId);
  }

  if (data.startsWith("movie:")) {
    const value = data.replace("movie:", "");
    if (value === "search") {
      const conversationData = await conversation.getConversation(chatId);
      if (!conversationData) return promptRestart(chatId, messageId);
      await conversation.setConversation(chatId, { ...conversationData, step: "movie_search", data: { ...conversationData.data, lastMessageId: messageId } });
      return sendOrEdit(chatId, messageId, "Type the movie's name:", { inline_keyboard: [BACK_CANCEL("back:movie")] });
    }

    const contentId = Number(value);
    const movie = await Movie.findOne({ contentId }).lean();
    if (!movie) return sendOrEdit(chatId, messageId, "That movie isn't available any more. Please pick another.", { inline_keyboard: [BACK_CANCEL("back:movie")] });

    const conversationData = await conversation.getConversation(chatId);
    if (!conversationData) return promptRestart(chatId, messageId);
    const options = await movieCatalogService.resolveMovieFilterOptions(
      movie,
      conversationData.data.city?.name
    );

    await conversation.setConversation(chatId, {
      ...conversationData,
      step: "date",
      data: { ...conversationData.data, movie: toConversationMovie(movie, options) },
    });
    return showDateSelection(chatId, messageId);
  }

  if (data === "search_district") return handleDistrictMovieSearch(chatId, messageId);

  if (data.startsWith("d_movie:")) {
    const id = data.replace("d_movie:", "");
    const conversationData = await conversation.getConversation(chatId);
    if (!conversationData) return promptRestart(chatId, messageId);
    if (!conversationData.data.districtMovies || !conversationData.data.districtMovies[id]) return showMovieSelection(chatId, messageId);

    const selected = conversationData.data.districtMovies[id];
    try {
      await upsertSearchedMovie(selected);
    } catch (error) {
      logger.error(TAG, `Failed to save searched movie ${id}`, error.message);
      return sendOrEdit(chatId, messageId, "Sorry, I couldn't add that movie just now. Please try again.", {
        inline_keyboard: [BACK_CANCEL("back:movie")]
      });
    }

    const movie = await Movie.findOne({ contentId: Number(id) }).lean();
    const options = await movieCatalogService.resolveMovieFilterOptions(movie, conversationData.data.city?.name);
    await conversation.setConversation(chatId, { ...conversationData, step: "date", data: { ...conversationData.data, movie: toConversationMovie(movie, options) } });
    return showDateSelection(chatId, messageId);
  }

  if (data.startsWith("date:")) {
    const dateStr = data.replace("date:", "");
    const conversationData = await conversation.getConversation(chatId);
    if (!conversationData) return promptRestart(chatId, messageId);
    await conversation.setConversation(chatId, { ...conversationData, step: "venues", data: { ...conversationData.data, alert_date: dateStr, venuePage: 0, venueQuery: "" } });
    return showVenueSelection(chatId, messageId);
  }

  if (data === "venue_search_prompt") {
    const conversationData = await conversation.getConversation(chatId);
    if (!conversationData) return promptRestart(chatId, messageId);
    await conversation.setConversation(chatId, { ...conversationData, step: "venue_search_prompt", data: { ...conversationData.data, lastMessageId: messageId } });
    return sendOrEdit(chatId, messageId, "Type the theatre's name:", { inline_keyboard: [BACK_CANCEL("back:venues")] });
  }

  if (data === "venue_search_clear") {
    const conversationData = await conversation.getConversation(chatId);
    if (!conversationData) return promptRestart(chatId, messageId);
    await conversation.setConversation(chatId, { ...conversationData, data: { ...conversationData.data, venueQuery: "", venuePage: 0 } });
    return showVenueSelection(chatId, messageId);
  }

  if (data.startsWith("venue_page:")) {
    const page = Math.max(0, parseInt(data.replace("venue_page:", ""), 10) || 0);
    const conversationData = await conversation.getConversation(chatId);
    if (!conversationData) return promptRestart(chatId, messageId);
    await conversation.setConversation(chatId, { ...conversationData, data: { ...conversationData.data, venuePage: page } });
    return showVenueSelection(chatId, messageId);
  }

  if (data.startsWith("venue:")) {
    const value = data.replace("venue:", "");
    const conversationData = await conversation.getConversation(chatId);
    if (!conversationData) return promptRestart(chatId, messageId);

    if (value === "any") {
      await conversation.setConversation(chatId, { ...conversationData, step: "filters", data: { ...conversationData.data, venues: [] } });
      return showFilterOptions(chatId, messageId);
    }
    if (value === "done") {
      await conversation.setConversation(chatId, { ...conversationData, step: "filters" });
      return showFilterOptions(chatId, messageId);
    }

    const venueId = Number(value);
    const venue = await Venue.findById(venueId).lean();
    if (!venue) return showVenueSelection(chatId, messageId);

    const currentVenues = conversationData.data.venues || [];
    const index = currentVenues.findIndex((item) => item.id === venueId);
    const newVenues = index >= 0 ? currentVenues.filter((item) => item.id !== venueId) : [...currentVenues, { id: venueId, name: venue.name }];
    await conversation.setConversation(chatId, { ...conversationData, data: { ...conversationData.data, venues: newVenues } });
    return showVenueSelection(chatId, messageId);
  }

  if (data.startsWith("filter_expand:")) {
    const filterKey = data.replace("filter_expand:", "");
    return showFilterExpanded(chatId, filterKey, messageId);
  }

  if (data.startsWith("filter_set:")) {
    const [, filterKey, ...valueParts] = data.split(":");
    const filterValue = valueParts.join(":");
    const conversationData = await conversation.getConversation(chatId);
    if (!conversationData) return promptRestart(chatId, messageId);

    const { options } = getFilterOptions(filterKey, conversationData.data);
    if (!["language", "format", "price"].includes(filterKey) || !options.includes(filterValue)) {
      return showFilterOptions(chatId, messageId);
    }

    const filters = conversationData.data.filters || { language: "Any", format: "Any", price: "Any" };
    filters[filterKey] = filterValue;
    await conversation.setConversation(chatId, { ...conversationData, data: { ...conversationData.data, filters } });
    return showFilterOptions(chatId, messageId);
  }

  if (data.startsWith("filter_toggle:")) {
    const key = data.split(":")[1];
    const conversationData = await conversation.getConversation(chatId);
    if (!conversationData) return promptRestart(chatId, messageId);

    const filters = conversationData.data.filters || { language: "Any", format: "Any", price: "Any" };
    const { options } = getFilterOptions(key, conversationData.data);
    if (options.length > 0) {
      filters[key] = options[(options.indexOf(filters[key]) + 1) % options.length];
    }
    await conversation.setConversation(chatId, { ...conversationData, data: { ...conversationData.data, filters } });
    return showFilterOptions(chatId, messageId);
  }

  if (data === "filter:apply") {
    const conversationData = await conversation.getConversation(chatId);
    if (!conversationData) return promptRestart(chatId, messageId);
    await conversation.setConversation(chatId, { ...conversationData, step: "confirm" });
    return showConfirmation(chatId, messageId);
  }

  if (data === "confirm:yes") return createAlertFromConversation(chatId, messageId);

  if (data.startsWith("cancel_alert:")) {
    const alertId = data.replace("cancel_alert:", "");
    return telegramBot.editMessageText("Cancel this alert?", {
      chat_id: chatId, message_id: messageId,
      reply_markup: { inline_keyboard: [[{ text: "Yes, cancel it", callback_data: `cancel_confirm:${alertId}` }, { text: "No, keep it", callback_data: "cancel_dismiss" }]] }
    });
  }

  if (data.startsWith("cancel_confirm:")) {
    const alertId = data.replace("cancel_confirm:", "");
    const user = await findLinkedUser(chatId);
    if (!user) return promptLink(chatId);
    const alert = await Alert.findOneAndUpdate({ _id: alertId, user_email: user.email, status: "ACTIVE" }, { $set: { status: "CANCELLED" } }, { new: true });
    if (!alert) return telegramBot.editMessageText("That alert isn't active any more. It may have already been sent or cancelled.", { chat_id: chatId, message_id: messageId });
    return telegramBot.editMessageText(`Your alert for *${escapeMarkdown(alert.movie.name)}* is cancelled.`, { chat_id: chatId, message_id: messageId, parse_mode: "Markdown" });
  }

  if (data === "cancel_dismiss") return telegramBot.editMessageText("Okay, your alert is still on.", { chat_id: chatId, message_id: messageId });
}

function toConversationMovie(movie, options = {}) {
  return {
    id: movie.contentId,
    name: movie.name,
    image_url: movie.image_url || null,
    release_date: movie.release_date || null,
    languages: dedupeIgnoreCase(options.languages || movie.extras?.language_variants || []),
    screen_formats: dedupeIgnoreCase(options.formats || movie.extras?.screen_formats || []),
  };
}

function truncate(value, length) {
  const text = String(value || "");
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

async function findLinkedUser(chatId) { return User.findOne({ "telegram.chat_id": String(chatId), "telegram.connected": true }); }
async function promptLink(chatId) {
  return telegramBot.sendMessage(
    chatId,
    `This chat isn't linked to a ${escapeMarkdown(APP_NAME)} account yet.\n\nSend /start to get a code, then enter it on the ${escapeMarkdown(APP_NAME)} website.`
  );
}
async function promptRestart(chatId, messageId) {
  return sendOrEdit(chatId, messageId, "This session timed out. Send /new to start again.", null);
}

async function handleQuickSearch(chatId, query) {
  const user = await findLinkedUser(chatId);
  if (!user) return promptLink(chatId);

  if (!query) {
    return telegramBot.sendMessage(chatId, "Send the movie's name after the command, like this:\n/search Pushpa");
  }

  const term = query.slice(0, 100);
  const allMovies = await findActiveMovies();
  const fuzzyResults = fuzzySearchMovies(allMovies, term).slice(0, 10);

  if (fuzzyResults.length === 0) {
    return telegramBot.sendMessage(chatId, `I couldn't find "${escapeMarkdown(term)}" in the current list.\n\nSend /new and tap Search to look further.`);
  }

  let text = `*Movies matching "${escapeMarkdown(term)}"*\n\n`;
  for (const movie of fuzzyResults) {
    const censor = movie.censor ? ` (${escapeMarkdown(movie.censor)})` : "";
    text += `• *${escapeMarkdown(movie.name)}*${censor}\n`;
  }
  text += "\nSend /new to set up an alert for one of these.";

  return telegramBot.sendMessage(chatId, text);
}

module.exports = { handleMessage, handleCallbackQuery };
