import mongoose from "mongoose";

const queueSchema = new mongoose.Schema(
  {
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      unique: true,
    },
    currentToken: {
      type: Number,
      default: 0,
    },

    estimatedTimePerPatient: {
      type: Number,
      default: 10,
    },

    delayInMinutes: {
      type: Number,
      default: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

export const Queue = mongoose.model("Queue", queueSchema);
