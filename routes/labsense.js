import express from "express";
import { labsenseController } from "../controllers/labsenseController.js";

const router = express.Router();

router.post("/", labsenseController);

export default router;
