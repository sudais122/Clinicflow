import { Doctor } from "../models/doctor.models.js";
import { Queue } from "../models/queue.models.js";
import { Appointment } from "../models/appointment.models.js";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";

// GET /dashboard/doctor
const getDoctorDashboard = async (req, res, next) => {
  try {
    const doctor = await Doctor.findOne({ user: req.user._id }).populate({
      path: "user",
      select: "fullname email",
    });
    if (!doctor) {
      throw new ApiError(403, "Only a doctor can view the doctor dashboard");
    }

    const { date } = req.query;
    let selected;
    if (date) {
      selected = new Date(date);
      if (isNaN(selected.getTime())) {
        throw new ApiError(400, "Invalid date");
      }
    } else {
      selected = new Date();
    }

    const startOfDay = new Date(selected);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(selected);
    endOfDay.setHours(23, 59, 59, 999);

    const appointments = await Appointment.find({
      doctor: doctor._id,
      appointmentDate: { $gte: startOfDay, $lte: endOfDay },
    }).lean();

    let waitingPatients = 0;
    let inProgress = 0;
    let completedAppointments = 0;
    let cancelledAppointments = 0;

    for (const appt of appointments) {
      if (appt.status === "waiting") waitingPatients += 1;
      else if (appt.status === "in-progress") inProgress += 1;
      else if (appt.status === "completed") completedAppointments += 1;
      else if (appt.status === "cancelled") cancelledAppointments += 1;
    }

    const queue = await Queue.findOne({ doctor: doctor._id }).lean();
    const selectedDate = startOfDay.toISOString().slice(0, 10);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          doctor: {
            _id:              doctor._id,              
            doctorId:        doctor.doctorId,
            fullname:        doctor.user?.fullname,
            email:           doctor.user?.email,
            clinicName:      doctor.clinicName,
            clinicAddress:   doctor.clinicAddress,
            specialization:  doctor.specialization,
            licenseNumber:   doctor.licenseNumber,
            experience:      doctor.experience,
            consultationFee: doctor.consultationFee,
            bio:             doctor.bio,
            clinicStatus:    doctor.clinicStatus,
            status:           doctor.status,             
            isSuspended:      doctor.isSuspended,        
            suspensionReason: doctor.suspensionReason,   
          },
          selectedDate,
          clinicStatus:            queue?.clinicStatus ?? "closed",
          currentServingToken:     queue?.nowServing ?? 0,
          totalAppointments:       appointments.length,
          waitingPatients,
          inProgress,
          completedAppointments,
          cancelledAppointments,
        },
        "Doctor dashboard fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};

export { getDoctorDashboard };