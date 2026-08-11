import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";


import { User } from "../models/user.models.js";
import { Doctor } from "../models/doctor.models.js";
import { Patient } from "../models/patient.models.js";
import { Subscription } from "../models/subscription.models.js";
import { Queue } from "../models/queue.models.js";
import { Counter } from "../models/counter.models.js";

import { generateDoctorId } from "../utils/id's/doctor.js";
import { generatePatientId } from "../utils/id's/Patient.js";
import { generateSubscriptionId } from "../utils/id's/subscription.js";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production", // false on local http
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
};

// generateAccessAndRefreshTokens
const generateAccessAndRefreshTokens = async (user) => {
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  return { accessToken, refreshToken };
};

// registerDoctor
const registerDoctor = async (req, res, next) => {
  try {
    const {
      fullname,
      email,
      password,
      phone,
      clinicName,
      clinicAddress,
      specialization,
      consultationFee,
    } = req.body;

    // Required fields
    if (
      [
        fullname,
        email,
        password,
        clinicName,
        phone,
        clinicAddress,
        specialization,
      ].some((field) => !field || field.trim() === "")
    ) {
      throw new ApiError(400, "All fields are required");
    }

    // Full name
    if (fullname.length < 3 || fullname.length > 50) {
      throw new ApiError(400, "Full name must be between 3 and 50 characters");
    }
    if (!/^[A-Za-z\s]+$/.test(fullname)) {
      throw new ApiError(400, "Full name can contain only letters and spaces");
    }

    // Email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      throw new ApiError(400, "Invalid email format");
    }

    // Phone 
    if (!/^03\d{9}$/.test(phone)) {
      throw new ApiError(400, "Phone must be 11 digits and start with 03");
    }

    // Password
    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_\-+=])[A-Za-z\d@$!%*?&#^()_\-+=]{8,}$/;
    if (!passwordRegex.test(password)) {
      throw new ApiError(
        400,
        "Password must be at least 8 characters and contain uppercase, lowercase, number and special character",
      );
    }

    // Clinic Name
    if (clinicName.length < 3 || clinicName.length > 100) {
      throw new ApiError(
        400,
        "Clinic name must be between 3 and 100 characters",
      );
    }

    // Clinic Address
    if (clinicAddress.length < 10 || clinicAddress.length > 200) {
      throw new ApiError(
        400,
        "Clinic address must be between 10 and 200 characters",
      );
    }

    // Specialization
    if (specialization.length < 3 || specialization.length > 50) {
      throw new ApiError(
        400,
        "Specialization must be between 3 and 50 characters",
      );
    }

    // Consultation Fee
    if (
      consultationFee === undefined ||
      consultationFee === null ||
      isNaN(consultationFee)
    ) {
      throw new ApiError(400, "Consultation fee is required");
    }
    if (Number(consultationFee) <= 0) {
      throw new ApiError(400, "Consultation fee must be greater than 0");
    }

    // Email already exists
    const existedUser = await User.findOne({ email: email.toLowerCase() });
    if (existedUser) {
      throw new ApiError(409, "Email already exists");
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const [user] = await User.create(
        [
          {
            fullname,
            email: email.toLowerCase(),
            password,
            phone,
            role: "doctor",
          },
        ],
        { session },
      );

      // Human-readable id, e.g. "DR-000125"
      const doctorId = await generateDoctorId({ session });

      const [doctor] = await Doctor.create(
        [
          {
            user: user._id,
            doctorId,
            clinicName,
            clinicAddress,
            specialization,
            consultationFee: Number(consultationFee),
          },
        ],
        { session },
      );

      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 30);

      const subscriptionId = await generateSubscriptionId({ session });

      await Subscription.create(
        [
          {
            subscriptionId,
            doctor: doctor._id,
            plan: "basic",
            price: 0,
            startDate,
            endDate,
            status: "active",
          },
        ],
        { session },
      );

      await Queue.create([{ doctor: doctor._id }], { session });

      await session.commitTransaction();

      const createdUser = await User.findById(user._id).select(
        "-password -refreshToken",
      );

      const createdDoctor = await Doctor.findById(doctor._id).select(
        "doctorId clinicName clinicAddress specialization consultationFee",
      );

      return res.status(201).json(
        new ApiResponse(
          201,
          { user: createdUser, doctor: createdDoctor },
          "Doctor registered successfully",
        ),
      );
    } catch (error) {
      await session.abortTransaction();
      throw error instanceof ApiError
        ? error
        : new ApiError(
            500,
            error?.message ||
              "Something went wrong while registering the doctor",
          );
    } finally {
      session.endSession();
    }
  } catch (error) {
    next(error);
  }
};
// registerPatient
const registerPatient = async (req, res, next) => {
  try {
    const {
      fullname,
      email,
      password,
      phone,
      dateOfBirth,
      gender,
      bloodGroup,
    } = req.body;

    // Required fields
    if (
      [fullname, email, password, phone, gender, bloodGroup].some(
        (field) => !field || field.trim() === "",
      )
    ) {
      throw new ApiError(400, "All fields are required");
    }

    // Full name
    if (fullname.length < 3 || fullname.length > 50) {
      throw new ApiError(400, "Full name must be between 3 and 50 characters");
    }
    if (!/^[A-Za-z\s]+$/.test(fullname)) {
      throw new ApiError(400, "Full name can contain only letters and spaces");
    }

    // Email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      throw new ApiError(400, "Invalid email format");
    }

    // Password
    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_\-+=])[A-Za-z\d@$!%*?&#^()_\-+=]{8,}$/;
    if (!passwordRegex.test(password)) {
      throw new ApiError(
        400,
        "Password must be at least 8 characters and contain uppercase, lowercase, number and special character",
      );
    }

    // Phone — must be 11 digits and start with 03
    if (!/^03\d{9}$/.test(phone)) {
      throw new ApiError(400, "Phone must be 11 digits and start with 03");
    }

    // Date of birth
    if (!dateOfBirth) {
      throw new ApiError(400, "Date of birth is required");
    }
    const dob = new Date(dateOfBirth);
    if (isNaN(dob.getTime())) {
      throw new ApiError(400, "Invalid date of birth");
    }
    if (dob >= new Date()) {
      throw new ApiError(400, "Date of birth must be in the past");
    }

    // Gender
    if (!["male", "female", "other"].includes(gender)) {
      throw new ApiError(400, "Gender must be male, female or other");
    }

    // Blood group
    const validBloodGroups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
    if (!validBloodGroups.includes(bloodGroup)) {
      throw new ApiError(400, "Invalid blood group");
    }

    // Email already exists
    const existedUser = await User.findOne({ email: email.toLowerCase() });
    if (existedUser) {
      throw new ApiError(409, "Email already exists");
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const [user] = await User.create(
        [
          {
            fullname,
            email: email.toLowerCase(),
            password,
            phone,
            role: "patient",
          },
        ],
        { session },
      );

      // Human-readable id, e.g. "PT-001245"
      const patientId = await generatePatientId({ session });

      const [patient] = await Patient.create(
        [{ user: user._id, patientId, dateOfBirth: dob, gender, bloodGroup }],
        { session },
      );

      await session.commitTransaction();

      const createdUser = await User.findById(user._id).select(
        "-password -refreshToken",
      );

      const createdPatient = await Patient.findById(patient._id).select(
        "patientId dateOfBirth gender bloodGroup",
      );

      return res.status(201).json(
        new ApiResponse(
          201,
          { user: createdUser, patient: createdPatient },
          "Patient registered successfully",
        ),
      );
    } catch (error) {
      await session.abortTransaction();
      throw error instanceof ApiError
        ? error
        : new ApiError(
            500,
            error?.message ||
              "Something went wrong while registering the patient",
          );
    } finally {
      session.endSession();
    }
  } catch (error) {
    next(error);
  }
};
// login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ApiError(400, "Email and password are required");
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      throw new ApiError(404, "User does not exist");
    }

    const isPasswordValid = await user.isPasswordCorrect(password);
    if (!isPasswordValid) {
      throw new ApiError(401, "Invalid credentials");
    }

    // Blocked-account check (admin can deactivate a user).
    if (user.isActive === false) {
      throw new ApiError(
        403,
        "Your account has been deactivated. Please contact the administrator.",
      );
    }

    const { accessToken, refreshToken } =
      await generateAccessAndRefreshTokens(user);

    const loggedInUser = await User.findById(user._id).select(
      "fullname email role",
    );

    // Attach the role-specific readable id (doctorId / patientId).
    let profileId = null;
    if (user.role === "doctor") {
      const doctor = await Doctor.findOne({ user: user._id }).select("doctorId");
      profileId = doctor?.doctorId || null;
    } else if (user.role === "patient") {
      const patient = await Patient.findOne({ user: user._id }).select("patientId");
      profileId = patient?.patientId || null;
    }

    return res
      .status(200)
      .cookie("accessToken", accessToken, cookieOptions)
      .cookie("refreshToken", refreshToken, cookieOptions)
      .json(
        new ApiResponse(
          200,
          { user: loggedInUser, profileId, accessToken, refreshToken },
          "Logged in successfully",
        ),
      );
  } catch (error) {
    next(error);
  }
};
// refreshAccessToken
const refreshAccessToken = async (req, res, next) => {
  try {
    const incomingRefreshToken =
      req.cookies?.refreshToken || req.body?.refreshToken;

    if (!incomingRefreshToken) {
      throw new ApiError(401, "Unauthorized request");
    }

    let decodedToken;
    try {
      decodedToken = jwt.verify(
        incomingRefreshToken,
        process.env.REFRESH_TOKEN_SECRET
      );
    } catch (error) {
      throw new ApiError(401, "Invalid or expired refresh token");
    }

    const user = await User.findById(decodedToken?._id);
    if (!user) {
      throw new ApiError(401, "Invalid refresh token");
    }
    if (incomingRefreshToken !== user.refreshToken) {
      throw new ApiError(401, "Refresh token is expired or already used");
    }

    const { accessToken, refreshToken } =
      await generateAccessAndRefreshTokens(user);

    return res
      .status(200)
      .cookie("accessToken", accessToken, cookieOptions)
      .cookie("refreshToken", refreshToken, cookieOptions)
      .json(
        new ApiResponse(
          200,
          { accessToken, refreshToken },
          "Access token refreshed successfully"
        )
      );
  } catch (error) {
    next(error);
  }
};

// logout
const logout = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(
      req.user._id,
      { $set: { refreshToken: "" } },
      { new: true }
    );

    return res
      .status(200)
      .clearCookie("accessToken", cookieOptions)
      .clearCookie("refreshToken", cookieOptions)
      .json(new ApiResponse(200, {}, "Logged out successfully"));
  } catch (error) {
    next(error);
  }
};

// getCurrentUser
const getCurrentUser = async (req, res, next) => {
  try {
    return res
      .status(200)
      .json(
        new ApiResponse(200, req.user, "Current user fetched successfully")
      );
  } catch (error) {
    next(error);
  }
};

export {
  registerDoctor,
  registerPatient,
  login,
  refreshAccessToken,
  logout,
  getCurrentUser,
};
