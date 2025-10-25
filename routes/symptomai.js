import express from "express";
import { symptomaiController } from "../controllers/symptomaiController.js";

const router = express.Router();

router.post("/", symptomaiController);

export default router;
