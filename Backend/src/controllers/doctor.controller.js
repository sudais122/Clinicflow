import mongoose from "mongoose";

import { User } from "../models/user.models.js";
import { Doctor } from "../models/doctor.models.js";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";

// PATCH /doctor/profile   (doctor only)
const updateDoctorProfile = async (req, res, next) => {
  try {
    const {
      fullname,
      clinicName,
      clinicAddress,
      specialization,
      consultationFee,
    } = req.body;

    // At least one updatable field must be present.
    if (
      fullname === undefined &&
      clinicName === undefined &&
      clinicAddress === undefined &&
      specialization === undefined &&
      consultationFee === undefined
    ) {
      throw new ApiError(400, "No fields provided to update");
    }

    // Validate only the fields that were actually sent (partial update).
    if (fullname !== undefined) {
      if (fullname.length < 3 || fullname.length > 50) {
        throw new ApiError(400, "Full name must be between 3 and 50 characters");
      }
      if (!/^[A-Za-z\s]+$/.test(fullname)) {
        throw new ApiError(400, "Full name can contain only letters and spaces");
      }
    }
    if (clinicName !== undefined && (clinicName.length < 3 || clinicName.length > 100)) {
      throw new ApiError(400, "Clinic name must be between 3 and 100 characters");
    }
    if (
      clinicAddress !== undefined &&
      (clinicAddress.length < 10 || clinicAddress.length > 200)
    ) {
      throw new ApiError(400, "Clinic address must be between 10 and 200 characters");
    }
    if (
      specialization !== undefined &&
      (specialization.length < 3 || specialization.length > 50)
    ) {
      throw new ApiError(400, "Specialization must be between 3 and 50 characters");
    }
    if (consultationFee !== undefined) {
      if (isNaN(consultationFee) || Number(consultationFee) <= 0) {
        throw new ApiError(400, "Consultation fee must be a number greater than 0");
      }
    }

    const doctor = await Doctor.findOne({ user: req.user._id });
    if (!doctor) {
      throw new ApiError(403, "Only a doctor can update the doctor profile");
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // User collection: fullname only.
      if (fullname !== undefined) {
        await User.findByIdAndUpdate(
          req.user._id,
          { $set: { fullname } },
          { session },
        );
      }

      // Doctor collection: the clinic fields.
      const doctorUpdates = {};
      if (clinicName !== undefined) doctorUpdates.clinicName = clinicName;
      if (clinicAddress !== undefined) doctorUpdates.clinicAddress = clinicAddress;
      if (specialization !== undefined) doctorUpdates.specialization = specialization;
      if (consultationFee !== undefined) {
        doctorUpdates.consultationFee = Number(consultationFee);
      }

      if (Object.keys(doctorUpdates).length > 0) {
        await Doctor.findByIdAndUpdate(
          doctor._id,
          { $set: doctorUpdates },
          { session },
        );
      }

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error instanceof ApiError
        ? error
        : new ApiError(500, error?.message || "Failed to update doctor profile");
    } finally {
      session.endSession();
    }

    // Return the fresh, merged profile.
    const updatedDoctor = await Doctor.findById(doctor._id)
      .select("doctorId clinicName clinicAddress specialization consultationFee user")
      .populate({ path: "user", select: "fullname email phone role" })
      .lean();

    return res
      .status(200)
      .json(
        new ApiResponse(200, updatedDoctor, "Doctor profile updated successfully"),
      );
  } catch (error) {
    next(error);
  }
};

const getAvailableDoctors = async (req, res, next) => {
  try {
    const doctors = await Doctor.find()
      .select(
        "doctorId specialization clinicName clinicAddress consultationFee user"
      )
      .populate({
        path: "user",
        select: "fullname email",
      })
      .lean();

    const formattedDoctors = doctors.map((doctor) => ({
      id: doctor._id,
      doctorId: doctor.doctorId,
      fullname: doctor.user?.fullname || "Unknown Doctor",
      specialization: doctor.specialization,
      clinicName: doctor.clinicName,
      clinicAddress: doctor.clinicAddress,
      consultationFee: doctor.consultationFee,
    }));

    return res.status(200).json(
      new ApiResponse(
        200,
        formattedDoctors,
        "Doctors fetched successfully"
      )
    );
  } catch (error) {
    next(error);
  }
};

export { updateDoctorProfile,getAvailableDoctors };