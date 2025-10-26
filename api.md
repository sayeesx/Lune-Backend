// API routes (mounted under /api)
app.use("/api/doctor", doctorRoutes);
app.use("/api/rxscan", rxscanRoutes);
app.use("/api/medguide", medguideRoutes);
app.use("/api/labsense", labsenseRoutes);
app.use("/api/scanvision", scanvisionRoutes);
app.use("/api/symptomai", symptomaiRoutes); // [web:231]
api/medguide/assistant (medguide)
http://localhost:8080/api/medguide/medicines
http://localhost:8080/api/medguide/assistant