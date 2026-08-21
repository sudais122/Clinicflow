import { Patient } from "../../models/patient.models.js";
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

const getPatients = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req);
    const { search, status } = req.query;

    let userFilter = { role: "patient" };
    if (status === "active") userFilter.isActive = true;
    if (status === "inactive") userFilter.isActive = false;
    if (search) {
      userFilter.$or = [
        { fullname: new RegExp(search, "i") },
        { email: new RegExp(search, "i") },
      ];
    }

    const matchingUsers = await User.find(userFilter).select("_id");
    const userIds = matchingUsers.map((u) => u._id);

    const [patients, total] = await Promise.all([
      Patient.find({ user: { $in: userIds } })
        .select("patientId dateOfBirth gender bloodGroup user createdAt")
        .populate({ path: "user", select: "fullname email phone isActive createdAt" })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Patient.countDocuments({ user: { $in: userIds } }),
    ]);

    return res.status(200).json(
      new ApiResponse(
        200,
        { patients, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
        "Patients fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};

const getPatientDetails = async (req, res, next) => {
  try {
    const patient = await Patient.findOne({ patientId: req.params.patientId }).populate({
      path: "user",
      select: "fullname email phone isActive createdAt",
    });
    if (!patient) throw new ApiError(404, "Patient not found");

    const [totalAppointments, completed, cancelled] = await Promise.all([
      Appointment.countDocuments({ patient: patient._id }),
      Appointment.countDocuments({ patient: patient._id, status: "completed" }),
      Appointment.countDocuments({ patient: patient._id, status: "cancelled" }),
    ]);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          patient: {
            patientId: patient.patientId,
            fullname: patient.user?.fullname,
            email: patient.user?.email,
            phone: patient.user?.phone,
            dateOfBirth: patient.dateOfBirth,
            gender: patient.gender,
            bloodGroup: patient.bloodGroup,
            isActive: patient.user?.isActive,
          },
          statistics: { totalAppointments, completed, cancelled },
        },
        "Patient details fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};

const getPatientAppointments = async (req, res, next) => {
  try {
    const patient = await Patient.findOne({ patientId: req.params.patientId });
    if (!patient) throw new ApiError(404, "Patient not found");

    const appointments = await Appointment.find({ patient: patient._id })
      .populate({
        path: "doctor",
        select: "doctorId clinicName user",
        populate: { path: "user", select: "fullname" },
      })
      .select("appointmentId status appointmentDate doctor")
      .sort({ appointmentDate: -1 })
      .lean();

    const formatted = appointments.map((a) => ({
      appointmentId: a.appointmentId,
      doctor: { doctorId: a.doctor?.doctorId, name: a.doctor?.user?.fullname },
      clinic: a.doctor?.clinicName,
      appointmentDate: a.appointmentDate,
      status: a.status,
    }));

    return res
      .status(200)
      .json(new ApiResponse(200, { appointments: formatted }, "Patient appointments fetched"));
  } catch (error) {
    next(error);
  }
};

const activatePatient = async (req, res, next) => {
  try {
    const patient = await Patient.findOne({ patientId: req.params.patientId });
    if (!patient) throw new ApiError(404, "Patient not found");

    const user = await User.findById(patient.user);
    if (!user) throw new ApiError(404, "User not found");
    if (user.isActive) throw new ApiError(400, "Patient already active");

    user.isActive = true;
    await user.save({ validateBeforeSave: false });

    return res
      .status(200)
      .json(new ApiResponse(200, { status: "active" }, "Patient activated"));
  } catch (error) {
    next(error);
  }
};

const disablePatient = async (req, res, next) => {
  try {
    const patient = await Patient.findOne({ patientId: req.params.patientId });
    if (!patient) throw new ApiError(404, "Patient not found");

    const user = await User.findById(patient.user);
    if (!user) throw new ApiError(404, "User not found");
    if (!user.isActive) throw new ApiError(400, "Patient already inactive");

    user.isActive = false;
    await user.save({ validateBeforeSave: false });

    return res
      .status(200)
      .json(new ApiResponse(200, { status: "inactive" }, "Patient disabled"));
  } catch (error) {
    next(error);
  }
};

export {
  getPatients,
  getPatientDetails,
  getPatientAppointments,
  activatePatient,
  disablePatient,
};