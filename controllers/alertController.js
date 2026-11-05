const Alert = require("../models/Alert");
const AlertNotification = require("../models/AlertNotification");
const { AlertDTO } = require("../dtos/alert.dto");
const { sendSuccess, sendError, sendServerError } = require("../utils/response");
const { createAlertForUser, findActivationConflict, alertLimitError, duplicateAlertError } = require("../services/alertService");
const { MAX_ACTIVE_ALERTS_PER_USER } = require("../constants/appConstants");

const TAG = "AlertController";
const ALERT_STATUSES = ["ACTIVE", "ALERTED", "CANCELLED", "EXPIRED"];
const ALERT_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const RESTORE_WINDOW_MS = 2 * 60 * 1000;

const parseStatuses = (raw) => {
  if (raw == null || raw === "") return [];
  if (typeof raw !== "string") return null;
  const statuses = raw.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
  return statuses.every((value) => ALERT_STATUSES.includes(value)) ? statuses : null;
};

const getAlerts = async (req, res) => {
  try {
    const { page, limit: limitParam } = req.query;
    const statuses = parseStatuses(req.query.status);
    if (statuses === null) {
      return sendError(res, `status must be one or more of ${ALERT_STATUSES.join(", ")}`, 400);
    }

    const query = { user_email: req.user.email };
    if (statuses.length === 1) query.status = statuses[0];
    else if (statuses.length > 1) query.status = { $in: statuses };

    const isHistory = statuses.length > 0 && !(statuses.length === 1 && statuses[0] === "ACTIVE");

    if (isHistory) {
      const pageNum = Math.max(parseInt(page) || 1, 1);
      const pageSize = Math.min(Math.max(parseInt(limitParam) || 10, 1), 50);
      const skip = (pageNum - 1) * pageSize;

      const [alerts, total] = await Promise.all([
        Alert.find(query).sort({ created_at: -1 }).skip(skip).limit(pageSize).lean(),
        Alert.countDocuments(query),
      ]);

      return sendSuccess(res, {
        alerts: AlertDTO.toCollectionResponse(alerts),
        pagination: {
          page: pageNum,
          limit: pageSize,
          total,
          total_pages: Math.ceil(total / pageSize),
          has_more: pageNum * pageSize < total,
        },
      });
    }

    const alerts = await Alert.find(query).sort({ created_at: -1 }).limit(200).lean();
    sendSuccess(res, AlertDTO.toCollectionResponse(alerts));
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

const getAlert = async (req, res) => {
  try {
    const alert = await Alert.findOne({
      _id: String(req.params.alertId),
      user_email: req.user.email,
    }).lean();
    if (!alert) return sendError(res, "We couldn't find that alert.", 404);

    const notifications = await AlertNotification.find({
      alert_id: alert._id,
    }).sort({ created_at: -1 }).lean();

    sendSuccess(res, AlertDTO.toDetailResponse(alert, notifications));
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

const createAlert = async (req, res) => {
  try {
    const { movie, city, venues: venuesInput, venue: venueInput, alert_date, filters } = req.body || {};

    const rawVenues = Array.isArray(venuesInput) && venuesInput.length > 0
      ? venuesInput
      : venueInput ? [venueInput] : [];
    if (rawVenues.some((venue) => venue?.id == null || !Number.isFinite(Number(venue.id)))) {
      return sendError(res, "Some of the theatres you picked aren't valid. Please pick them again.", 400, "THEATRE_NOT_FOUND");
    }

    const alert = await createAlertForUser(req.user.email, {
      movieId: movie?.id,
      city: typeof city === "string" ? city : city?.name,
      venueIds: rawVenues.map((venue) => Number(venue.id)),
      alertDate: alert_date,
      filters,
    });

    sendSuccess(res, AlertDTO.toResponse(alert), "Alert created", 201);
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

const cancelAlert = async (req, res) => {
  try {
    const alertId = String(req.params.alertId);
    if (!ALERT_ID_PATTERN.test(alertId)) return sendError(res, "We couldn't find that alert.", 404);

    const alert = await Alert.findOneAndUpdate(
      {
        _id: alertId,
        user_email: req.user.email,
        status: "ACTIVE",
      },
      { $set: { status: "CANCELLED" } },
      { new: true }
    );

    if (!alert) {
      return sendError(res, "This alert isn't active any more. It may have already been sent or cancelled.", 404);
    }

    sendSuccess(res, AlertDTO.toResponse(alert), "Alert cancelled");
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

const restoreAlert = async (req, res) => {
  try {
    const alertId = String(req.params.alertId);
    if (!ALERT_ID_PATTERN.test(alertId)) return sendError(res, "We couldn't find that alert.", 404);

    const activeCount = await Alert.countDocuments({ user_email: req.user.email, status: "ACTIVE" });
    if (activeCount >= MAX_ACTIVE_ALERTS_PER_USER) {
      return sendError(res, `You already have ${MAX_ACTIVE_ALERTS_PER_USER} active alerts, so this one can't be restored.`, 409, "ALERT_LIMIT");
    }

    const alert = await Alert.findOneAndUpdate(
      {
        _id: alertId,
        user_email: req.user.email,
        status: "CANCELLED",
        updated_at: { $gte: new Date(Date.now() - RESTORE_WINDOW_MS) },
      },
      { $set: { status: "ACTIVE", activated_at: new Date() } },
      { new: true }
    );

    if (!alert) return sendError(res, "This alert can't be restored any more.", 404);

    const conflict = await findActivationConflict(req.user.email, alert._id);
    if (conflict) {
      await Alert.updateOne({ _id: alert._id, status: "ACTIVE" }, { $set: { status: "CANCELLED" } }, { timestamps: false });
      const error = conflict === "duplicate" ? duplicateAlertError() : alertLimitError();
      return sendError(res, conflict === "duplicate" ? error.message : `You already have ${MAX_ACTIVE_ALERTS_PER_USER} active alerts, so this one can't be restored.`, 409, error.code);
    }

    sendSuccess(res, AlertDTO.toResponse(alert), "Alert restored");
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

module.exports = { getAlerts, getAlert, createAlert, cancelAlert, restoreAlert };
