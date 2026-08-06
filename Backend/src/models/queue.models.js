import mongoose from "mongoose";

const queueSchema = new mongoose.Schema(
  {
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      unique: true,
    },

    // Last token number ISSUED. Incremented every time a patient books.
    // This is the "ticket counter" — it only goes up.
    lastToken: {
      type: Number,
      default: 0,
    },

    // Token currently BEING SERVED. Starts at 0 (nobody yet) and is
    // advanced by the doctor as each patient is called in.
    nowServing: {
      type: Number,
      default: 0,
    },

    estimatedTimePerPatient: {
      type: Number,
      default: 10, // minutes
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
  },
);

export const Queue = mongoose.model("Queue", queueSchema);