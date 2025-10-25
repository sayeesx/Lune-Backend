import express from "express";
import { rxscanController } from "../controllers/rxscanController.js";

const router = express.Router();

router.post("/", rxscanController);

export default router;
