const mongoose = require("mongoose");
const crypto = require("crypto");

const ALERT_STATUSES = ["ACTIVE", "ALERTED", "CANCELLED", "EXPIRED"];

const alertFiltersSchema = new mongoose.Schema(
  {
    formats: [{ type: String }],
    languages: [{ type: String }],
    show_time_min: { type: Number, default: null },
    show_time_max: { type: Number, default: null },
    price_min: { type: Number, default: null },
    price_max: { type: Number, default: null },
  },
  { _id: false }
);

const alertSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => crypto.randomUUID() },

    user_email: {
      type: String,
      required: true,
      ref: "User",
      trim: true,
      lowercase: true,
    },

    movie: {
      id: { type: Number, required: true },
      name: { type: String, required: true },
      image_url: { type: String, default: null },
    },

    city: {
      name: { type: String, required: true },
    },

    venues: [{
      id: { type: Number, required: true },
      name: { type: String, default: null },
      source: { type: String, enum: ["district", "bookmyshow"], default: "district" },
      _id: false,
    }],

    alert_date: { type: Date, required: true },

    status: {
      type: String,
      enum: ALERT_STATUSES,
      default: "ACTIVE",
    },

    filters: { type: alertFiltersSchema, default: () => ({}) },

    last_scan_group_key: { type: String, default: null },
    last_checked_at: { type: Date, default: null },
    notified_at: { type: Date, default: null },
    expires_at: { type: Date, default: null },
    activated_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    _id: false,
  }
);

alertSchema.index(
  { status: 1, alert_date: 1 },
  { partialFilterExpression: { status: "ACTIVE" } }
);

alertSchema.index({ user_email: 1, status: 1 });

alertSchema.index({ "movie.id": 1, "city.name": 1, status: 1 });

alertSchema.index({ expires_at: 1 });

module.exports = mongoose.model("Alert", alertSchema);
