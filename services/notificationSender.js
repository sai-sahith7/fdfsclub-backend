const Alert = require("../models/Alert");
const AlertNotification = require("../models/AlertNotification");
const User = require("../models/User");
const City = require("../models/City");
const logger = require("../utils/logger");
const districtClient = require("../clients/districtClient");
const { buildMovieUrl } = require("../utils/districtLink");
const { renderAlertEmail, renderAlertText, buildAlertSubject } = require("../renderers/emailTemplate");
const { APP_NAME } = require("../constants/appConstants");
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: Number(process.env.SMTP_PORT) || 1025,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: process.env.SMTP_USER ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  } : undefined
});

const TAG = "NotificationSender";

async function sendNotification(alert, matches) {
  if (!matches || matches.length === 0) return;

  const { session } = matches[0];

  const user = await User.findOne({ email: alert.user_email });
  if (!user) {
    logger.error(TAG, `User not found for alert ${alert._id} (${alert.user_email})`);
    return;
  }

  const notifiedAt = new Date();
  const claimed = await Alert.findOneAndUpdate(
    { _id: alert._id, status: "ACTIVE" },
    { $set: { status: "ALERTED", notified_at: notifiedAt } },
    { new: true }
  );
  if (!claimed) {
    logger.info(TAG, `Alert ${alert._id} is no longer active, skipping notification`);
    return;
  }

  const channels = [];
  channels.push("email");
  if (user.telegram?.connected) {
    channels.push("telegram");
  }

  let seatLayout = [];
  if (!isBookMyShow(session)) {
    try {
      seatLayout = await districtClient.getSeatLayout({
        cinemaId: session.cinemaId,
        sessionId: session.sessionId,
        providerId: session.providerId,
        movieCode: session.movieCode,
        contentId: alert.movie.id,
        screenFormat: session.screenFormat,
        freeSeating: false,
      });
    } catch (error) {
      logger.error(TAG, `Failed to fetch seat layout for session ${session.sessionId}`, error.message);
    }
  }

  const districtUrl = matches.some((match) => !isBookMyShow(match.session)) ? await buildBookingUrl(alert) : null;

  const matchesPayload = matches.map(match => {
    const fromBookMyShow = isBookMyShow(match.session);
    return {
      venue: match.cinema.name,
      showtime: match.session.showTime,
      screen: match.session.screen,
      screen_format: match.session.screenFormat || "Standard",
      language: match.session.language || null,
      seats_available: fromBookMyShow ? null : match.session.available || 0,
      price: getMinPrice(match.session) || null,
      areas: match.session.areas || [],
      booking_url: fromBookMyShow ? match.session.bookingUrl || match.cinema.bookingUrl : districtUrl,
      source: fromBookMyShow ? "bookmyshow" : "district",
    };
  });

  const notificationPayload = {
    movie: alert.movie.name,
    matches: matchesPayload,
    seat_layout: seatLayout,
    booking_url: matchesPayload.some((match) => match.source === "district")
      ? districtUrl
      : matchesPayload[0].booking_url,
  };

  let created = 0;
  for (const channel of channels) {
    try {
      const notification = new AlertNotification({
        alert_id: alert._id,
        channel,
        payload: notificationPayload,
        status: "pending",
        retry_count: 0,
      });
      await notification.save();
      created++;

      logger.info(TAG, `Created ${channel} notification ${notification._id} for alert ${alert._id}`);
    } catch (error) {
      logger.error(TAG, `Failed to create ${channel} notification for alert ${alert._id}`, error.message);
    }
  }

  if (created === 0) {
    await Alert.updateOne(
      { _id: alert._id, status: "ALERTED", notified_at: notifiedAt },
      { $set: { status: "ACTIVE", notified_at: null } }
    ).catch((error) => logger.error(TAG, `Failed to release alert ${alert._id}`, error.message));
    logger.error(TAG, `No notification could be created for alert ${alert._id}, released for the next scan`);
    return;
  }

  const notifications = await AlertNotification.find({
    alert_id: alert._id,
    status: "pending",
  });

  for (const notification of notifications) {
    try {
      await dispatchNotification(notification, user, alert);

      await AlertNotification.findOneAndUpdate(
        { _id: notification._id },
        { $set: { status: "sent", sent_at: new Date() } }
      );
      logger.info(TAG, `Sent ${notification.channel} notification ${notification._id}`);
    } catch (error) {
      await AlertNotification.findOneAndUpdate(
        { _id: notification._id },
        { $set: { status: "failed" } }
      );
      logger.error(TAG, `Failed to send ${notification.channel} notification ${notification._id}`, error.message);
    }
  }
}

async function dispatchNotification(notification, user, alert) {
  const payload = notification.payload;

  if (notification.channel === "email") {
    const html = renderAlertEmail(payload);

    try {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || `"${APP_NAME} Alerts" <alerts@localhost>`,
        to: user.email,
        subject: buildAlertSubject(payload),
        html,
        text: renderAlertText(payload),
      });
      logger.info(TAG, `Sent email to ${user.email} for ${payload.movie} with ${payload.matches.length} matches`);
    } catch (error) {
      logger.error(TAG, `Nodemailer failed to send email to ${user.email}`, error.message);
      throw error;
    }
    return;
  }

  if (notification.channel === "telegram") {
    const telegramBot = require("../clients/telegramBot");
    const { renderTelegramCaption } = require("../renderers/telegramTemplate");
    const { renderSatoriSeatMap } = require("../renderers/satoriTemplate");
    const satori = require("satori").default || require("satori");
    const { Resvg } = require("@resvg/resvg-js");
    const fs = require("fs");
    const path = require("path");

    if (!user.telegram?.chat_id) {
      throw new Error("User has no telegram chat_id");
    }

    const captionText = renderTelegramCaption(payload);

    let imageBuffer;
    try {
      const vNode = renderSatoriSeatMap(payload);
      if (vNode) {
        const robotoRegular = fs.readFileSync(path.join(__dirname, '../assets/Roboto-Regular.ttf'));
        const robotoMedium = fs.readFileSync(path.join(__dirname, '../assets/Roboto-Medium.ttf'));

        const svg = await satori(vNode, {
          width: 600,
          fonts: [
            { name: 'Roboto', data: robotoRegular, weight: 400, style: 'normal' },
            { name: 'Roboto', data: robotoMedium, weight: 500, style: 'normal' },
          ],
        });

        const resvg = new Resvg(svg, {
          background: '#0e0e14',
          fitTo: { mode: 'width', value: 600 },
        });

        imageBuffer = resvg.render().asPng();
      }
    } catch (error) {
      logger.error(TAG, "Failed to generate satori seat map image for Telegram", error.message);
    }

    if (imageBuffer) {
      await telegramBot.sendPhoto(user.telegram.chat_id, imageBuffer, {
        caption: captionText,
        parse_mode: "Markdown"
      });
    } else {
      await telegramBot.sendMessage(user.telegram.chat_id, captionText, { parse_mode: "Markdown" });
    }

    logger.info(
      TAG,
      `Sent Telegram notification to chat ${user.telegram.chat_id} for ${payload.movie} with ${payload.matches.length} matches`
    );
    return;
  }

  throw new Error(`Unknown notification channel: ${notification.channel}`);
}

const CITY_LINK_RECHECK_MS = 30 * 24 * 60 * 60 * 1000;
const CITY_LINK_RETRY_MS = 24 * 60 * 60 * 1000;

async function buildBookingUrl(alert) {
  const movie = { movieName: alert.movie.name, contentId: alert.movie.id };
  const movieUrl = buildMovieUrl(movie);

  let city = null;
  try {
    city = await City.findOne({ name: alert.city?.name }).lean();
  } catch (error) {
    logger.error(TAG, `Failed to resolve city slug for ${alert.city?.name}`, error.message);
  }
  if (!city?.slug) return movieUrl;

  const cityUrl = buildMovieUrl({ ...movie, citySlug: city.slug, cityName: city.name });
  if (cityUrl === movieUrl) return movieUrl;

  const sameSlug = city.district_link_slug === city.slug;
  const known = sameSlug ? city.district_link_ok : null;
  const checkedAt = sameSlug && city.district_link_checked_at ? new Date(city.district_link_checked_at).getTime() : 0;
  if (Date.now() - checkedAt >= (known == null ? CITY_LINK_RETRY_MS : CITY_LINK_RECHECK_MS)) {
    checkCityLink(city, cityUrl, movieUrl).catch((error) =>
      logger.error(TAG, `District link check failed for ${city.name}`, error.message)
    );
  }

  return known === true ? cityUrl : movieUrl;
}

async function checkCityLink(city, cityUrl, movieUrl) {
  const sameSlug = city.district_link_slug === city.slug;
  const claim = await City.updateOne(
    { _id: city._id, district_link_checked_at: city.district_link_checked_at ?? null },
    {
      $set: {
        district_link_checked_at: new Date(),
        district_link_slug: city.slug,
        ...(sameSlug ? {} : { district_link_ok: null }),
      },
    }
  );
  if (claim.modifiedCount === 0) return;

  let works = await districtClient.pageExists(cityUrl);
  if (works === false && (await districtClient.pageExists(movieUrl)) !== true) works = null;
  if (works === true || works === false) {
    await City.updateOne({ _id: city._id }, { $set: { district_link_ok: works } });
  }
}

function isBookMyShow(session) {
  return session?.source === "bookmyshow";
}

function getMinPrice(session) {
  const areas = session.areas || [];
  let minimum = Infinity;
  for (const area of areas) {
    if (area.price > 0 && area.price < minimum) minimum = area.price;
  }
  return minimum === Infinity ? null : minimum;
}

module.exports = { sendNotification, dispatchNotification, buildBookingUrl, checkCityLink };
