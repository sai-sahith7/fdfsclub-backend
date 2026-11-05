const mongoose = require("mongoose");

const movieSchema = new mongoose.Schema(
  {
    contentId: { type: Number, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    image_url: { type: String, default: null },
    runtime_minutes: { type: Number, default: null },
    censor: { type: String, default: null },
    frmtids: [{ type: String }],
    release_date: { type: String, default: null },
    booking_status: { type: String, default: null },
    extras: {
      genres: [{ type: String }],
      trailer_url: { type: String, default: null },
      language_variants: [{ type: String }],
      screen_formats: [{ type: String }],
    },
    language_format_map: { type: Map, of: String, default: () => new Map() },
    requested_by_user: { type: Boolean, default: false },
    last_seen_active_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

movieSchema.index({ name: "text" });

module.exports = mongoose.model("Movie", movieSchema);
