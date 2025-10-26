// src/server.js
import "dotenv/config.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";

// Routes
import doctorRoutes from "./routes/doctor.js";
import rxscanRoutes from "./routes/rxscan.js";
import medguideRoutes from "./routes/medguide.js";
import labsenseRoutes from "./routes/labsense.js";
import scanvisionRoutes from "./routes/scanvision.js";
import symptomaiRoutes from "./routes/symptomai.js";

// Middleware
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { apiLimiter } from "./middleware/rateLimiter.js";

// Utils
import { checkGroqHealth } from "./utils/groqClient.js";

const app = express();
const PORT = process.env.PORT || 8080;
const { MONGODB_URI } = process.env;

// Security headers
app.use(helmet()); // [web:231]

// CORS
app.use(
  cors({
    origin: process.env.EXPO_APP_ORIGIN || "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
); // [web:231]
app.options("*", cors()); // [web:231]

// Body parsers
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" })); // [web:231]

// Rate limiting on API namespace
app.use("/api", apiLimiter); // [web:231]

// Health check endpoint (Groq + Mongo)
app.get("/health", async (_req, res) => {
  let groqStatus = { ok: false };
  try {
    groqStatus = await checkGroqHealth();
  } catch {
    groqStatus = { ok: false, error: "groq check failed" };
  }

  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  const mongo = {
    ok: mongoose.connection.readyState === 1,
    state: states[mongoose.connection.readyState] || String(mongoose.connection.readyState),
    db: mongoose.connection.name || null,
  };

  return res.json({
    status: mongo.ok ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    service: "Lune Backend API",
    version: "1.0.0",
    groq: groqStatus,
    mongo,
    endpoints: [
      "/api/doctor",
      "/api/rxscan",
      "/api/medguide",
      "/api/labsense",
      "/api/scanvision",
      "/api/symptomai",
    ],
  });
}); // [web:295][web:105]

// API routes (mounted under /api)
app.use("/api/doctor", doctorRoutes);
app.use("/api/rxscan", rxscanRoutes);
app.use("/api/medguide", medguideRoutes);
app.use("/api/labsense", labsenseRoutes);
app.use("/api/scanvision", scanvisionRoutes);
app.use("/api/symptomai", symptomaiRoutes); // [web:231]

// Root endpoint
app.get("/", (_req, res) => {
  res.json({
    message: "Lune Medical AI API",
    version: "1.0.0",
    status: "running",
    features: [
      "AI Doctor",
      "Rx Scan",
      "MedGuide",
      "LabSense",
      "ScanVision (Coming Soon)",
      "SymptomAI",
    ],
    documentation: "/health",
  });
}); // [web:231]

// 404 and global error handlers
app.use(notFoundHandler);
app.use(errorHandler); // [web:231]

// Connection event logs (visibility during runtime)
mongoose.connection.on("connected", () => {
  console.log("✅ Mongoose connected:", mongoose.connection.name);
});
mongoose.connection.on("disconnected", () => {
  console.warn("⚠️  Mongoose disconnected");
});
mongoose.connection.on("reconnected", () => {
  console.log("🔄 Mongoose reconnected");
});
mongoose.connection.on("error", (err) => {
  console.error("❌ Mongoose error:", err);
}); // [web:102]

// Graceful shutdown
const shutdown = async (signal) => {
  try {
    console.log(`Received ${signal}, closing HTTP and Mongo connections...`);
    await mongoose.connection.close();
    process.exit(0);
  } catch (e) {
    console.error("Error during shutdown:", e);
    process.exit(1);
  }
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM")); // [web:295]

// Bootstrap: await MongoDB before listening
(async function bootstrap() {
  if (!MONGODB_URI) {
    console.error("MONGODB_URI is not set");
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 20,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 20000,
    }); // [web:102]

    // Only start HTTP server once connected
    app.listen(PORT, () => {
      console.log(`🚀 Lune Backend Server running on port ${PORT}`);
      console.log(`🌙 Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`📍 Health check: http://localhost:${PORT}/health`);
      console.log(`✅ Mongo connected to DB: ${mongoose.connection.name}`);
    });
  } catch (err) {
    console.error("Failed to connect to MongoDB:", err);
    process.exit(1);
  }
})();
