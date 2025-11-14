import express from "express";
import { doctorController } from "../controllers/doctorController.js";
import { authenticateUser } from "../src/middleware/authMiddleware.js";

const router = express.Router();

// Apply auth middleware before the controller
router.post("/", authenticateUser, doctorController);

export default router;