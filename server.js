// server.js (ESM)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import doctorRoutes from "./routes/doctor.js";
import rxscanRoutes from "./routes/rxscan.js";
import medguideRoutes from "./routes/medguide.js";
import labsenseRoutes from "./routes/labsense.js";
import scanvisionRoutes from "./routes/scanvision.js";
import symptomaiRoutes from "./routes/symptomai.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// CORS: Restrict to Expo app's domain or localhost during development
app.use(cors({ origin: process.env.EXPO_APP_ORIGIN || "*" }));

// Parse JSON, set request size limit
app.use(express.json({ limit: "1mb" }));

// Register routes
app.use("/api/doctor", doctorRoutes);
app.use("/api/rxscan", rxscanRoutes);
app.use("/api/medguide", medguideRoutes);
app.use("/api/labsense", labsenseRoutes);
app.use("/api/scanvision", scanvisionRoutes);
app.use("/api/symptomai", symptomaiRoutes);

// Error-handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Server error, contact support." });
});

// Start
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
