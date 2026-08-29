import { Doctor } from "../models/doctor.models.js";
import { Notification } from "../models/Notification.models.js";
import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";

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

async function notifyBookingLimitReached(doctorId, patientId, appointmentDate) {
  const dayKey = appointmentDate.toLocaleDateString("en-CA", {
    timeZone: "Asia/Karachi",
  });
  const dedupeKey = `BOOKING_LIMIT_REACHED:${doctorId}:${patientId}:${dayKey}`;

  try {
    await Notification.create({
      recipient: doctorId,
      doctor: doctorId,
      patient: patientId,
      type: "BOOKING_LIMIT_REACHED",
      title: "New booking opportunity",
      message:
        "A new appointment was booked beyond your Free plan's daily limit. It's saved and waiting — upgrade to Practice to view and serve it.",
      appointmentDate,
      read: false,
      metadata: { dedupeKey },
    });
  } catch (notifyError) {
    if (notifyError?.code === 11000) {
      return; // duplicate for this exact booking opportunity — already notified
    }
    console.error("Failed to create booking-limit notification:", notifyError);
  }
}

export {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  notifyBookingLimitReached,
};