import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema(
  {
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      unique: true,
    },
    subscriptionId: {
      type: String,
      unique: true,
      required: true
    },
    plan: {
      type: String,
      enum: ["basic"],
      default: "basic",
    },

    price: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },

    startDate: {
      type: Date,
      required: true,
      default: Date.now,
    },

    endDate: {
      type: Date,
      required: true,
    },

    status: {
      type: String,
      enum: ["active", "expired"],
      default: "active",
    },
  },
  {
    timestamps: true,
  },
);

export const Subscription = mongoose.model(
  "Subscription",
  subscriptionSchema,
);