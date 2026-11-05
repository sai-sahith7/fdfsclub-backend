const mongoose = require("mongoose");

const citySchema = new mongoose.Schema({
  _id: { type: Number },
  name: { type: String, required: true, trim: true },
  state_key: { type: String, default: null, trim: true },
  slug: { type: String, required: true, trim: true },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  image_url: { type: String, default: null },
  is_active: { type: Boolean, default: true },
  last_movie_sync_at: { type: Date, default: null },
  last_venue_sync_at: { type: Date, default: null },
  bms_region: {
    code: { type: String, default: null },
    slug: { type: String, default: null },
  },
  last_bms_sync_at: { type: Date, default: null },
  district_link_ok: { type: Boolean, default: null },
  district_link_checked_at: { type: Date, default: null },
  district_link_slug: { type: String, default: null },
  movie_sync_requested_at: { type: Date, default: null },
  venue_sync_requested_at: { type: Date, default: null },
  bms_sync_requested_at: { type: Date, default: null },
});

citySchema.index({ slug: 1, state_key: 1 }, { unique: true });
citySchema.index({ is_active: 1 });
citySchema.index({ movie_sync_requested_at: 1 }, { sparse: true });
citySchema.index({ venue_sync_requested_at: 1 }, { sparse: true });
citySchema.index({ bms_sync_requested_at: 1 }, { sparse: true });

module.exports = mongoose.model("City", citySchema);
