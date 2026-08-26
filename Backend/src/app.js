console.log("NODE_ENV:", process.env.NODE_ENV);

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
import forgotPasswordRoutes from "./routes/Forgotpassword.routes.js";
import emailChangeRoutes from "./routes/emailChange.routes.js";
import reportRoutes from "./routes/reports.routes.js";
import revenueRoutes from "./routes/Revenue.routes.js";
import paymentRoutes from "./routes/patient.routes.js";

//admin
import adminRouter from "./routes/admin.routes.js";
import adminDoctorRouter from "./routes/adminDoctor.routes.js";
import adminPatientRouter from "./routes/adminPatient.routes.js";
import adminSubscriptionRouter from "./routes/adminSubscription.routes.js";
import adminReportRouter from "./routes/adminReport.routes.js";
import adminPaymentRouter from "./routes/adminPayment.routes.js";

const app = express();

app.use(
  cors({
    origin: [
      "http://127.0.0.1:5500",
      "http://localhost:5500",
    ],
    credentials: true,
  }),
);

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("../../frontend"));
app.use(cookieParser());

//auth routes
app.use("/auth", authroutes);
app.use("/auth/password", forgotPasswordRoutes);

//docotor
app.use("/appointments", appointmentroutes);
app.use("/queue", queueroutes);

app.use("/doctor", doctorroutes);

app.use("/auth/email", emailChangeRoutes);

app.use("/patient", patientroutes);
app.use("/dashboard", dashboardroutes);
app.use("/subscription", subscriptionroutes);
app.use("/revenue", revenueRoutes);
app.use("/payments", paymentRoutes);

app.use("/support", reportRoutes);

//admin routes
app.use("/admin", adminRouter);
app.use("/admin/doctors", adminDoctorRouter);
app.use("/admin/patients", adminPatientRouter);
app.use("/admin/subscriptions", adminSubscriptionRouter);
app.use("/admin/reports", adminReportRouter);
app.use("/admin/payments", adminPaymentRouter);

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  return res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error",
    errors: err.errors || [],
  });
});

export { app };