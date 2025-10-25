import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";

// Import routes
import doctorRoutes from "./routes/doctor.js";
import rxscanRoutes from "./routes/rxscan.js";
import medguideRoutes from "./routes/medguide.js";
import labsenseRoutes from "./routes/labsense.js";
import scanvisionRoutes from "./routes/scanvision.js";
import symptomaiRoutes from "./routes/symptomai.js";

// Import middleware
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { apiLimiter } from "./middleware/rateLimiter.js";

// Import utils
import { checkGroqHealth } from "./utils/groqClient.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.EXPO_APP_ORIGIN || "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Body parser middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Apply rate limiting to API routes
app.use("/api", apiLimiter);

// Health check endpoint
app.get("/health", async (req, res) => {
  const groqStatus = await checkGroqHealth();
  
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "Lune Backend API",
    version: "1.0.0",
    groq: groqStatus,
    endpoints: [
      "/api/doctor",
      "/api/rxscan",
      "/api/medguide",
      "/api/labsense",
      "/api/scanvision",
      "/api/symptomai"
    ]
  });
});

// API routes
app.use("/api/doctor", doctorRoutes);
app.use("/api/rxscan", rxscanRoutes);
app.use("/api/medguide", medguideRoutes);
app.use("/api/labsense", labsenseRoutes);
app.use("/api/scanvision", scanvisionRoutes);
app.use("/api/symptomai", symptomaiRoutes);

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "🌙 Lune Medical AI API",
    version: "1.0.0",
    status: "running",
    powered_by: "Groq (Llama 3.3 70B)",
    features: [
      "AI Doctor",
      "Rx Scan",
      "MedGuide",
      "LabSense",
      "ScanVision (Coming Soon)",
      "SymptomAI"
    ],
    documentation: "/health",
    note: "Ultra-fast medical AI inference powered by Groq"
  });
});

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Lune Backend Server running on port ${PORT}`);
  console.log(`🌙 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`⚡ Powered by Groq API (Llama 3.3 70B)`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`\n✅ Ready to serve medical AI requests!`);
});

export default app;
