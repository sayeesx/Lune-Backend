import express from "express";
import { scanvisionController } from "../controllers/scanvisionController.js";

const router = express.Router();

router.post("/", scanvisionController);

export default router;
