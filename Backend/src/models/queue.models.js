import mongoose from "mongoose";

const queueSchema = new mongoose.Schema(
  {
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      unique: true,
    },
    lastToken: {
      type: Number,
      default: 0,
    },
    nowServing: {
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
    clinicStatus: {
      type: String,
      enum: ["open", "closed"],
      default: "closed",
    },

    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

export const Queue = mongoose.model("Queue", queueSchema);