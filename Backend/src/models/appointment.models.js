import mongoose from "mongoose";

const appointmentSchema = new mongoose.Schema(
  {
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },

    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },

    appointmentDate: {
      type: Date,
      required: true,
    },

    tokenNumber: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: [
        "waiting",
        "completed",
        "cancelled",
      ],
      default: "waiting",
    },
  },
  {
    timestamps: true,
  },
);

export const Appointment = mongoose.model(
  "Appointment",
  appointmentSchema,
);