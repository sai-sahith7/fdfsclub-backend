const logger = require("./logger");

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

const sendSuccess = (res, data, message = "Success", statusCode = 200) => {
  return res.status(statusCode).json({ status: true, message, data });
};

const sendError = (res, message = "Something went wrong", statusCode = 500, code = undefined) => {
  const body = { status: false, message };
  if (code) body.code = code;
  return res.status(statusCode).json(body);
};

const sendPaginatedSuccess = (res, items, total, page, limit, message = "Success", statusCode = 200) => {
  return res.status(statusCode).json({
    status: true,
    message,
    data: items,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
};

class HttpError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.expose = true;
  }
}

const sendServerError = (res, error, tag = "API") => {
  const statusCode = Number(error?.statusCode) || 500;
  if (error?.expose || (statusCode >= 400 && statusCode < 500)) {
    return sendError(res, error.message, statusCode, typeof error.code === "string" ? error.code : undefined);
  }
  logger.error(tag, error?.message || "Unknown error", error?.stack);
  return sendError(res, GENERIC_ERROR_MESSAGE, statusCode >= 500 ? statusCode : 500);
};

module.exports = { sendSuccess, sendError, sendPaginatedSuccess, sendServerError, HttpError, GENERIC_ERROR_MESSAGE };
