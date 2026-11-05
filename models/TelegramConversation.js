const mongoose = require("mongoose");

const telegramConversationSchema = new mongoose.Schema(
  {
    chat_id: { type: String, required: true, unique: true },
    step: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    expires_at: { type: Date, required: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

telegramConversationSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("TelegramConversation", telegramConversationSchema);
