import express from "express";
import { medguideController } from "../controllers/medguideController.js";

const router = express.Router();

router.post("/", medguideController);

export default router;
