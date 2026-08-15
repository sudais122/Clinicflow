import mongoose from "mongoose";

import { User } from "../models/user.models.js";
import { Patient } from "../models/patient.models.js";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";

const validBloodGroups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

// PATCH /patient/profile   (patient only)
const updatePatientProfile = async (req, res, next) => {
  try {
    let { fullname, dateOfBirth, gender, bloodGroup, phone } = req.body;

    if (
      fullname === undefined &&
      dateOfBirth === undefined &&
      gender === undefined &&
      bloodGroup === undefined &&
      phone === undefined
    ) {
      throw new ApiError(400, "No fields provided to update");
    }

    if (fullname !== undefined) {
      fullname = String(fullname).trim();

      if (fullname.length < 3 || fullname.length > 50) {
        throw new ApiError(
          400,
          "Full name must be between 3 and 50 characters",
        );
      }

      if (!/^[A-Za-z\s]+$/.test(fullname)) {
        throw new ApiError(
          400,
          "Full name can contain only letters and spaces",
        );
      }
    }

    if (phone !== undefined) {
      phone = String(phone).trim();

      if (!/^[+\d][\d\s-]{6,14}\d$/.test(phone)) {
        throw new ApiError(400, "Please enter a valid phone number");
      }
    }

    let dob;

    if (dateOfBirth !== undefined && dateOfBirth !== "") {
      dob = new Date(dateOfBirth);

      if (isNaN(dob.getTime())) {
        throw new ApiError(400, "Invalid date of birth");
      }

      if (dob >= new Date()) {
        throw new ApiError(
          400,
          "Date of birth must be in the past",
        );
      }
    }

    if (gender !== undefined && gender !== "") {
      gender = String(gender).toLowerCase();

      if (!["male", "female", "other"].includes(gender)) {
        throw new ApiError(
          400,
          "Gender must be male, female or other",
        );
      }
    }

    if (
      bloodGroup !== undefined &&
      !validBloodGroups.includes(bloodGroup)
    ) {
      throw new ApiError(400, "Invalid blood group");
    }

    const patient = await Patient.findOne({
      user: req.user._id,
    });

    if (!patient) {
      throw new ApiError(
        403,
        "Only a patient can update the patient profile",
      );
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      if (fullname !== undefined || phone !== undefined) {
        const userUpdates = {};
        if (fullname !== undefined) userUpdates.fullname = fullname;
        if (phone !== undefined) userUpdates.phone = phone;

        await User.findByIdAndUpdate(
          req.user._id,
          { $set: userUpdates },
          { session, new: true },
        );
      }

      const patientUpdates = {};

      if (dob !== undefined) {
        patientUpdates.dateOfBirth = dob;
      }

      if (gender !== undefined && gender !== "") {
        patientUpdates.gender = gender;
      }

      if (bloodGroup !== undefined) {
        patientUpdates.bloodGroup = bloodGroup;
      }

      if (Object.keys(patientUpdates).length > 0) {
        await Patient.findByIdAndUpdate(
          patient._id,
          { $set: patientUpdates },
          { session, new: true },
        );
      }

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();

      throw error instanceof ApiError
        ? error
        : new ApiError(
            500,
            error?.message || "Failed to update patient profile",
          );
    } finally {
      await session.endSession();
    }

    const updatedPatient = await Patient.findById(patient._id)
      .select("patientId dateOfBirth gender bloodGroup user")
      .populate({
        path: "user",
        select: "fullname email phone role",
      })
      .lean();

    return res.status(200).json(
      new ApiResponse(
        200,
        updatedPatient,
        "Patient profile updated successfully",
      ),
    );
  } catch (error) {
    next(error);
  }
};

// getCurrentUser
const getCurrentUser = async (req, res, next) => {
  try {
    let profile = null;
    if (req.user.role === "patient") {
      profile = await Patient.findOne({ user: req.user._id })
        .select("patientId dateOfBirth gender bloodGroup")
        .lean();
    } else if (req.user.role === "doctor") {
      profile = await Doctor.findOne({ user: req.user._id })
        .select("doctorId clinicName clinicAddress specialization consultationFee")
        .lean();
    }

    return res
      .status(200)
      .json(new ApiResponse(200, { ...req.user.toObject(), profile }, "Current user fetched successfully"));
  } catch (error) {
    next(error);
  }
};

export { updatePatientProfile ,getCurrentUser};