import mongoose from "mongoose";

import { User } from "../models/user.models.js";
import { Patient } from "../models/patient.models.js";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";

const validBloodGroups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

// PATCH /patient/profile   (patient only)
const updatePatientProfile = async (req, res, next) => {
  try {
    let { fullname, dateOfBirth, gender, bloodGroup } = req.body;

    if (
      fullname === undefined &&
      dateOfBirth === undefined &&
      gender === undefined &&
      bloodGroup === undefined
    ) {
      throw new ApiError(400, "No fields provided to update");
    }

    // Validate the sent fields.
    if (fullname !== undefined) {
      if (fullname.length < 3 || fullname.length > 50) {
        throw new ApiError(400, "Full name must be between 3 and 50 characters");
      }
      if (!/^[A-Za-z\s]+$/.test(fullname)) {
        throw new ApiError(400, "Full name can contain only letters and spaces");
      }
    }

    let dob;
    if (dateOfBirth !== undefined) {
      dob = new Date(dateOfBirth);
      if (isNaN(dob.getTime())) {
        throw new ApiError(400, "Invalid date of birth");
      }
      if (dob >= new Date()) {
        throw new ApiError(400, "Date of birth must be in the past");
      }
    }

    if (gender !== undefined) {
      gender = String(gender).toLowerCase(); // normalize "Male" -> "male"
      if (!["male", "female", "other"].includes(gender)) {
        throw new ApiError(400, "Gender must be male, female or other");
      }
    }

    if (bloodGroup !== undefined && !validBloodGroups.includes(bloodGroup)) {
      throw new ApiError(400, "Invalid blood group");
    }

    const patient = await Patient.findOne({ user: req.user._id });
    if (!patient) {
      throw new ApiError(403, "Only a patient can update the patient profile");
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      if (fullname !== undefined) {
        await User.findByIdAndUpdate(
          req.user._id,
          { $set: { fullname } },
          { session },
        );
      }

      const patientUpdates = {};
      if (dob !== undefined) patientUpdates.dateOfBirth = dob;
      if (gender !== undefined) patientUpdates.gender = gender;
      if (bloodGroup !== undefined) patientUpdates.bloodGroup = bloodGroup;

      if (Object.keys(patientUpdates).length > 0) {
        await Patient.findByIdAndUpdate(
          patient._id,
          { $set: patientUpdates },
          { session },
        );
      }

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error instanceof ApiError
        ? error
        : new ApiError(500, error?.message || "Failed to update patient profile");
    } finally {
      session.endSession();
    }

    const updatedPatient = await Patient.findById(patient._id)
      .select("patientId dateOfBirth gender bloodGroup user")
      .populate({ path: "user", select: "fullname email phone role" })
      .lean();

    return res
      .status(200)
      .json(
        new ApiResponse(200, updatedPatient, "Patient profile updated successfully"),
      );
  } catch (error) {
    next(error);
  }
};

export { updatePatientProfile };