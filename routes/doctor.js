import express from "express";
import { doctorController } from "../controllers/doctorController.js";

const router = express.Router();

router.post("/", doctorController);

export default router;
