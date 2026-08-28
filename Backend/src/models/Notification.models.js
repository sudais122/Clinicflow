import mongoose from "mongoose";

// Extend as more notification types get added.
const NOTIFICATION_TYPES = ["BOOKING_LIMIT_REACHED"];

const notificationSchema = new mongoose.Schema(
  {
    // Who sees this notification. For every type today this is a
    // Doctor, but kept generically named in case a patient-facing
    // notification type gets added later.
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    // Context fields for this notification type — doctor duplicates
    // `recipient` today (kept separate for clarity/future types).
    // `patient` is an opaque ObjectId reference only, never raw
    // name/phone — per "do not store unnecessary sensitive patient
    // information".
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
    },
    appointmentDate: {
      type: Date,
    },
    // metadata.dedupeKey backs the unique index below — see
    // notification.controller.js's notifyBookingLimitReached for how
    // it's built. Mixed/free-form so future notification types can
    // store whatever context they need without a schema change.
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true },
);

// Prevents unlimited duplicate notifications for the same booking
// opportunity (same doctor + patient + day + type) — see spec's
// duplicate-prevention requirement. sparse: true because not every
// notification type is guaranteed to set metadata.dedupeKey.
notificationSchema.index({ "metadata.dedupeKey": 1 }, { unique: true, sparse: true });

export const Notification = mongoose.model("Notification", notificationSchema);
export { NOTIFICATION_TYPES };