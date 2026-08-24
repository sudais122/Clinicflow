import mongoose from "mongoose";

const appointmentSchema = new mongoose.Schema(
  {
    appointmentId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      index: true,
    },

    bookedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },

    patientName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    patientPhone: {
      type: String,
      required: true,
      trim: true,
    },

    appointmentDate: {
      type: Date,
      required: true,
      index: true,
    },

    tokenNumber: {
      type: Number,
      required: true,
      min: 1,
    },

    status: {
      type: String,
      enum: ["waiting", "in-progress", "completed", "cancelled"],
      default: "waiting",
      index: true,
    },
    consultationFee: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid"],
      default: "unpaid",
    },

    paidAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

export const Appointment = mongoose.model("Appointment", appointmentSchema);
