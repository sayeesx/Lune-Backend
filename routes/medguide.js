// src/routes/medguide.js
import express from "express";
import dbConnect from "../lib/mongodb.js";
import Medicine from "../models/Medicine.js";
import { medicineAssistantController as medicineAssistant } from "../controllers/medicineAssistantController.js";

const router = express.Router();

const escapeRegex = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /medicines (paginated)
router.get("/medicines", async (req, res) => {
  try {
    await dbConnect();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 100, 500));
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      Medicine.find({}, null, { sort: { name: 1 }, skip, limit }).lean().exec(),
      Medicine.estimatedDocumentCount().exec(),
    ]);

    return res.json({
      page,
      limit,
      total,
      count: data.length,
      data,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch medicines", details: err.message });
  }
});

// GET /medicines/search?name=&manufacturer=&type=&limit=
router.get("/medicines/search", async (req, res) => {
  try {
    await dbConnect();
    const { name = "", manufacturer = "", type = "", limit = "50" } = req.query;

    const q = {};
    const lim = Math.max(1, Math.min(parseInt(limit, 10) || 50, 200));
    if (name) q.name = { $regex: escapeRegex(String(name)), $options: "i" };
    if (manufacturer) q.manufacturer_name = { $regex: escapeRegex(String(manufacturer)), $options: "i" };
    if (type) q.type = { $regex: escapeRegex(String(type)), $options: "i" };

    if (!q.name && !q.manufacturer_name && !q.type) {
      return res.status(400).json({
        error: "Provide at least one query parameter: name, manufacturer, or type",
      });
    }

    const docs = await Medicine.find(q, null, { limit: lim, sort: { name: 1 } })
      .lean()
      .exec();

    return res.json({ count: docs.length, data: docs });
  } catch (err) {
    return res.status(500).json({ error: "Search failed", details: err.message });
  }
});

// POST / - AI-powered medicine assistant (THIS IS THE CHANGE!)
router.post("/", medicineAssistant);

export default router;
