const mongoose = require("mongoose");

const telegramConnectionSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    telegram_handle: {
      type: String,
      required: true,
      trim: true,
    },
    chat_id: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: ["PENDING", "COMPLETED"],
      default: "PENDING",
    },
    expires_at: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

telegramConnectionSchema.index({ expires_at: 1 });
telegramConnectionSchema.index({ status: 1 });

module.exports = mongoose.model("TelegramConnection", telegramConnectionSchema);
