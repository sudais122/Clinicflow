import mongoose from "mongoose";

const doctorSchema = new mongoose.Schema(
  {
    doctorId: { type: String, unique: true, required: true, trim: true },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    clinicName: { type: String, required: true, trim: true },
    clinicAddress: { type: String, required: true, trim: true },
    specialization: { type: String, required: true, trim: true },
    licenseNumber: { type: String, required: true, unique: true, trim: true },
    experience: { type: Number, required: true, min: 0 },
    consultationFee: { type: Number, required: true, min: 0 },
    bio: { type: String, trim: true, maxlength: 1000 },

    clinicStatus: {
      type: String,
      enum: ["closed", "open"],
      default: "closed",
    },
    status: {
      type: String,
      enum: ["pending", "active", "inactive"],
      default: "pending",
    },

    isSuspended: {
      type: Boolean,
      default: false,
    },
    suspensionReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: undefined,
    },
  },
  { timestamps: true },
);

export const Doctor = mongoose.model("Doctor", doctorSchema);