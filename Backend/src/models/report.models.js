import mongoose from "mongoose";

const reportSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["doctor", "patient"],
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: ["open", "reviewed", "resolved"],
      default: "open",
    },
  },
  {
    timestamps: true,
  },
);

export const Report = mongoose.model("Report", reportSchema);