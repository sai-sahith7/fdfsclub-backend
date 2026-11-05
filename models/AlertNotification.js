const mongoose = require("mongoose");
const crypto = require("crypto");

const CHANNELS = ["email", "telegram"];
const STATUSES = ["pending", "sent", "failed", "dead"];

const alertNotificationSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => crypto.randomUUID() },

    alert_id: {
      type: String,
      required: true,
      ref: "Alert",
    },

    channel: {
      type: String,
      enum: CHANNELS,
      required: true,
    },

    payload: {
      movie: { type: String, default: null },
      matches: [{
        venue: { type: String, default: null },
        showtime: { type: String, default: null },
        screen: { type: String, default: null },
        screen_format: { type: String, default: null },
        language: { type: String, default: null },
        seats_available: { type: Number, default: null },
        price: { type: Number, default: null },
        areas: [{ type: mongoose.Schema.Types.Mixed }],
        booking_url: { type: String, default: null },
        source: { type: String, enum: ["district", "bookmyshow"], default: "district" },
      }],
      seat_layout: { type: mongoose.Schema.Types.Mixed, default: null },
      booking_url: { type: String, default: null },
    },

    status: {
      type: String,
      enum: STATUSES,
      default: "pending",
    },

    retry_count: { type: Number, default: 0 },
    sent_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    _id: false,
  }
);

alertNotificationSchema.index({ alert_id: 1 });

alertNotificationSchema.index(
  { status: 1, created_at: 1 },
  { name: "retry_candidates", partialFilterExpression: { status: { $in: ["failed", "pending"] } } }
);

alertNotificationSchema.index({ alert_id: 1, status: 1 });

module.exports = mongoose.model("AlertNotification", alertNotificationSchema);
