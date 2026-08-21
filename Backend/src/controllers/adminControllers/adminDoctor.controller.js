import mongoose from "mongoose";

import { Doctor } from "../../models/doctor.models.js";
import { User } from "../../models/user.models.js";
import { Appointment } from "../../models/appointment.models.js";

import ApiError from "../../utils/apierror.js";
import ApiResponse from "../../utils/apiresponse.js";

const getPagination = (req) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const getDoctors = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req);
    const { search, status, specialization } = req.query;

    const doctorFilter = {};
    if (status) {
      if (!["pending", "active", "inactive"].includes(status)) {
        throw new ApiError(400, "Invalid status filter");
      }
      doctorFilter.status = status;
    }
    if (specialization) {
      doctorFilter.specialization = new RegExp(specialization, "i");
    }

    if (search) {
      const matchingUsers = await User.find({
        role: "doctor",
        $or: [
          { fullname: new RegExp(search, "i") },
          { email: new RegExp(search, "i") },
        ],
      }).select("_id");
      doctorFilter.user = { $in: matchingUsers.map((u) => u._id) };
    }

    const [doctors, total] = await Promise.all([
      Doctor.find(doctorFilter)
        .select(
          "doctorId clinicName clinicAddress specialization licenseNumber experience consultationFee status isSuspended user createdAt",
        )
        .populate({ path: "user", select: "fullname email phone isActive createdAt" })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Doctor.countDocuments(doctorFilter),
    ]);

    return res.status(200).json(
      new ApiResponse(
        200,
        { doctors, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
        "Doctors fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};

const getDoctorDetails = async (req, res, next) => {
  try {
    const { doctorId } = req.params;

    const doctor = await Doctor.findOne({ doctorId })
      .populate({ path: "user", select: "fullname email phone isActive createdAt" });

    if (!doctor) {
      throw new ApiError(404, "Doctor not found");
    }

    const [totalAppointments, completed, cancelled, waiting, inProgress] = await Promise.all([
      Appointment.countDocuments({ doctor: doctor._id }),
      Appointment.countDocuments({ doctor: doctor._id, status: "completed" }),
      Appointment.countDocuments({ doctor: doctor._id, status: "cancelled" }),
      Appointment.countDocuments({ doctor: doctor._id, status: "waiting" }),
      Appointment.countDocuments({ doctor: doctor._id, status: "in-progress" }),
    ]);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          doctor: {
            doctorId: doctor.doctorId,
            fullname: doctor.user?.fullname,
            email: doctor.user?.email,
            phone: doctor.user?.phone,
            specialization: doctor.specialization,
            experience: doctor.experience,
            licenseNumber: doctor.licenseNumber,
            clinicName: doctor.clinicName,
            clinicAddress: doctor.clinicAddress,
            consultationFee: doctor.consultationFee,
            bio: doctor.bio,
            status: doctor.status,
            isSuspended: doctor.isSuspended,
            suspensionReason: doctor.suspensionReason,
            clinicStatus: doctor.clinicStatus,
          },
          statistics: {
            totalAppointments,
            completed,
            cancelled,
            waiting,
            inProgress,
          },
        },
        "Doctor details fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};

const getDoctorAppointments = async (req, res, next) => {
  try {
    const { doctorId } = req.params;
    const { date } = req.query;

    const doctor = await Doctor.findOne({ doctorId }).populate({
      path: "user",
      select: "fullname",
    });
    if (!doctor) {
      throw new ApiError(404, "Doctor not found");
    }

    const filter = { doctor: doctor._id };
    if (date) {
      const dayStart = new Date(date);
      if (isNaN(dayStart.getTime())) {
        throw new ApiError(400, "Invalid date");
      }
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      filter.appointmentDate = { $gte: dayStart, $lte: dayEnd };
    }

    const appointments = await Appointment.find(filter)
      .select("appointmentId patientName status appointmentDate")
      .sort({ appointmentDate: 1 })
      .lean();

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          date: date || null,
          doctor: { doctorId: doctor.doctorId, fullname: doctor.user?.fullname },
          totalAppointments: appointments.length,
          appointments,
        },
        "Doctor appointments fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};

const approveDoctor = async (req, res, next) => {
  try {
    const doctor = await Doctor.findOne({ doctorId: req.params.doctorId });
    if (!doctor) throw new ApiError(404, "Doctor not found");
    if (doctor.status === "active") throw new ApiError(400, "Doctor already active");

    doctor.status = "active";
    await doctor.save();
    await User.findByIdAndUpdate(doctor.user, { isActive: true });

    return res
      .status(200)
      .json(new ApiResponse(200, { status: doctor.status }, "Doctor approved"));
  } catch (error) {
    next(error);
  }
};

const activateDoctor = async (req, res, next) => {
  try {
    const doctor = await Doctor.findOne({ doctorId: req.params.doctorId });
    if (!doctor) throw new ApiError(404, "Doctor not found");
    if (doctor.status === "active") throw new ApiError(400, "Doctor already active");

    doctor.status = "active";
    await doctor.save();
    await User.findByIdAndUpdate(doctor.user, { isActive: true });

    return res
      .status(200)
      .json(new ApiResponse(200, { status: doctor.status }, "Doctor activated"));
  } catch (error) {
    next(error);
  }
};

const deactivateDoctor = async (req, res, next) => {
  try {
    const doctor = await Doctor.findOne({ doctorId: req.params.doctorId });
    if (!doctor) throw new ApiError(404, "Doctor not found");
    if (doctor.status === "inactive") throw new ApiError(400, "Doctor already inactive");

    doctor.status = "inactive";
    await doctor.save();
    await User.findByIdAndUpdate(doctor.user, { isActive: false });

    return res
      .status(200)
      .json(new ApiResponse(200, { status: doctor.status }, "Doctor deactivated"));
  } catch (error) {
    next(error);
  }
};

const suspendDoctor = async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      throw new ApiError(400, "Suspension reason is required");
    }

    const doctor = await Doctor.findOne({ doctorId: req.params.doctorId });
    if (!doctor) throw new ApiError(404, "Doctor not found");
    if (doctor.isSuspended) throw new ApiError(400, "Doctor already suspended");

    doctor.isSuspended = true;
    doctor.suspensionReason = reason.trim();
    await doctor.save();

    return res.status(200).json(
      new ApiResponse(
        200,
        { isSuspended: true, suspensionReason: doctor.suspensionReason },
        "Doctor suspended",
      ),
    );
  } catch (error) {
    next(error);
  }
};

const unsuspendDoctor = async (req, res, next) => {
  try {
    const doctor = await Doctor.findOne({ doctorId: req.params.doctorId });
    if (!doctor) throw new ApiError(404, "Doctor not found");
    if (!doctor.isSuspended) throw new ApiError(400, "Doctor is not suspended");

    doctor.isSuspended = false;
    doctor.suspensionReason = undefined;
    await doctor.save();

    return res
      .status(200)
      .json(new ApiResponse(200, { isSuspended: false }, "Doctor unsuspended"));
  } catch (error) {
    next(error);
  }
};

export {
  getDoctors,
  getDoctorDetails,
  getDoctorAppointments,
  approveDoctor,
  activateDoctor,
  deactivateDoctor,
  suspendDoctor,
  unsuspendDoctor,
};