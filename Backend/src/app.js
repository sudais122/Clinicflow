import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import authroutes from "./routes/auth.routes.js";
import appointmentroutes from "./routes/appointment.routes.js";
import queueroutes from "./routes/queue.routes.js";
import doctorroutes from "./routes/doctor.routes.js";
import patientroutes from "./routes/patient.routes.js";
import dashboardroutes from "./routes/doctorDashboard.routes.js";
import subscriptionroutes from "./routes/subscription.routes.js";
import adminroutes from "./routes/admin.routes.js";
import forgotPasswordRoutes from "./routes/Forgotpassword.routes.js";

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
app.use("/auth/password", forgotPasswordRoutes);
app.use("/appointments", appointmentroutes);
app.use("/queue", queueroutes);
app.use("/doctor", doctorroutes);
app.use("/patient", patientroutes);
app.use("/dashboard", dashboardroutes);
app.use("/subscription", subscriptionroutes);
app.use("/admin", adminroutes);

// Global error handler 
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  return res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error",
    errors: err.errors || [],
  });
});

export { app };