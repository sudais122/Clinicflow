import { Doctor } from "../models/doctor.models.js";
import { Notification } from "../models/Notification.models.js";
import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";

// Same resolution pattern used throughout the codebase — req.user is
// the User account, Doctor has its own _id with a `user` ref.
const getDoctorForUser = async (userId) => {
  const doctor = await Doctor.findOne({ user: userId });
  if (!doctor) {
    throw new ApiError(403, "Only a doctor can access notifications");
  }
  return doctor;
};

// GET /notifications  (doctor)
const getMyNotifications = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.user._id);
    const notifications = await Notification.find({ recipient: doctor._id })
      .sort({ createdAt: -1 })
      .lean();
    return res
      .status(200)
      .json(new ApiResponse(200, notifications, "Notifications fetched"));
  } catch (error) {
    next(error);
  }
};

// PATCH /notifications/:notificationId/read  (doctor)
const markNotificationRead = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.user._id);
    const { notificationId } = req.params;

    // Scoped to this doctor's own recipient id — a doctor can never
    // touch another doctor's notification, matching or not.
    const notification = await Notification.findOne({
      _id: notificationId,
      recipient: doctor._id,
    });
    if (!notification) {
      throw new ApiError(404, "Notification not found");
    }

    notification.read = true;
    await notification.save();

    return res
      .status(200)
      .json(new ApiResponse(200, notification, "Notification marked as read"));
  } catch (error) {
    next(error);
  }
};

// PATCH /notifications/read-all  (doctor)
const markAllNotificationsRead = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.user._id);
    await Notification.updateMany(
      { recipient: doctor._id, read: false },
      { $set: { read: true } },
    );
    return res
      .status(200)
      .json(new ApiResponse(200, null, "All notifications marked as read"));
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   notifyBookingLimitReached — called from appointment.controller.js
   at the exact point bookAppointment detects the Free-plan daily
   limit has been reached.

   MUST be called WITHOUT a Mongoose session — this is a plain,
   independent write, deliberately outside the appointment-booking
   transaction. That transaction gets aborted immediately after (the
   whole point of the booking-limit condition), and Mongoose
   transaction aborts roll back every write made WITH that session.
   A write with no session is entirely unaffected by another
   session's abort, which is exactly what makes the notification
   survive while the appointment/token do not.

   Duplicate prevention: relies on the unique index on
   metadata.dedupeKey (doctor + patient + calendar day + type). A
   second call for the same booking opportunity — whether from the
   same patient clicking Confirm repeatedly, or in the rare case this
   function fires more than once for one logical attempt — hits a
   MongoDB E11000 duplicate-key error, which is caught and treated as
   success (a notification for this opportunity already exists).
   ============================================================ */
async function notifyBookingLimitReached(doctorId, patientId, appointmentDate) {
  const dayKey = appointmentDate.toLocaleDateString("en-CA", {
    timeZone: "Asia/Karachi",
  }); // "YYYY-MM-DD"
  const dedupeKey = `BOOKING_LIMIT_REACHED:${doctorId}:${patientId}:${dayKey}`;

  try {
    await Notification.create({
      recipient: doctorId,
      doctor: doctorId,
      patient: patientId,
      type: "BOOKING_LIMIT_REACHED",
      title: "New booking opportunity",
      message:
        "A patient attempted to book an appointment with you, but your Free plan has reached today's appointment limit. Upgrade to Practice to receive more appointments.",
      appointmentDate,
      read: false,
      metadata: { dedupeKey },
    });
  } catch (notifyError) {
    if (notifyError?.code === 11000) {
      return; // duplicate for this exact booking opportunity — fine, already notified
    }
    // Never let a notification failure block or crash the actual
    // booking-limit response — this is a side effect, not the main
    // outcome the patient/doctor is waiting on.
    console.error("Failed to create booking-limit notification:", notifyError);
  }
}

export {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  notifyBookingLimitReached,
};