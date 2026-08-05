import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import authroutes from "./routes/auth.routes.js";
import appointmentroutes from "./routes/appointment.routes.js";

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
  })
);

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public"));
app.use(cookieParser());

// Routes
app.use("/auth", authroutes);
app.use("/appointments", appointmentroutes);

// Global error handler (must stay after routes)
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  return res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error",
    errors: err.errors || [],
  });
});

export { app };