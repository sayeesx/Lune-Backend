// routes/encyclopedia.js
import express from "express";
import { medicineEncyclopediaController } from "../controllers/medicineEncyclopediaController.js";

const router = express.Router();

router.post("/", medicineEncyclopediaController);

export default router;
