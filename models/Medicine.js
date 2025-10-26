// src/models/Medicine.js
import mongoose from "mongoose";

const MedicineSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, index: true, unique: true },
    name: { type: String, required: true, trim: true, index: true },
    price: { type: Number, default: null },
    is_discontinued: { type: Boolean, default: false },
    manufacturer_name: { type: String, trim: true, index: true },
    type: { type: String, trim: true, index: true },
    pack_size_label: { type: String, trim: true },
    short_composition1: { type: String, trim: true },
    short_composition2: { type: String, trim: true },

    // New fields seen in your sample
    salt_composition: { type: String, trim: true },
    medicine_desc: { type: String, trim: true },
    side_effects: { type: String, trim: true },       // comma-separated in your sample
    drug_interactions: { type: Object, default: {} },  // nested object if present

    // Optional: temporary alias for legacy capitalization (read-only convenience)
    // Is_discontinued: { type: Boolean, select: false }, // avoid duplicating in payloads
  },
  { versionKey: false, timestamps: false }
);

MedicineSchema.index({ name: 1, manufacturer_name: 1 });

const Medicine = mongoose.models.Medicine || mongoose.model("Medicine", MedicineSchema, "medicines");
export default Medicine;
