const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    image_url: {
      type: String,
      default: null,
    },
    default_city: {
      name: { type: String, default: null },
      slug: { type: String, default: null },
    },
    favourite_city: {
      name: { type: String, default: null },
      slug: { type: String, default: null },
    },
    telegram: {
      chat_id: { type: String, default: null },
      username: { type: String, default: null },
      connected: { type: Boolean, default: false },
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

userSchema.index({ "default_city.name": 1 });
userSchema.index({ "favourite_city.slug": 1 });

module.exports = mongoose.model("User", userSchema);
