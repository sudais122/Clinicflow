import mongoose from "mongoose";
import jwt from "jsonwebtoken";

import { User } from "../models/user.model.js";
import { Doctor } from "../models/doctor.model.js";
import { Patient } from "../models/patient.model.js";
import { Subscription } from "../models/subscription.model.js";
import { Queue } from "../models/queue.model.js";

import AsyncHandler from "../utils/asynchandler.js";
import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apierror.js";


const cookieOptions = {
  httpOnly: true,
  secure: true,
};

// generateAccessAndRefreshTokens
const generateAccessAndRefreshTokens = async (user) => {
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  return { accessToken, refreshToken };
};


//registerDoctor
const registerDoctor = AsyncHandler(async (req, res) => {
  const {
    fullname,
    email,
    password,
    clinicName,
    clinicAddress,
    specialization,
    consultationFee,
  } = req.body;

  if (
    [fullname, email, password, clinicName, clinicAddress, specialization].some(
      (field) => !field || field.trim() === "",
    )
  ) {
    throw new ApiError(400, "All fields are required");
  }

  if (consultationFee === undefined || consultationFee === null) {
    throw new ApiError(400, "Consultation fee is required");
  }

  const existedUser = await User.findOne({ email });
  if (existedUser) {
    throw new ApiError(409, "User with this email already exists");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const [user] = await User.create(
      [{ fullname, email, password, role: "doctor" }],
      { session },
    );

    const [doctor] = await Doctor.create(
      [
        {
          user: user._id,
          clinicName,
          clinicAddress,
          specialization,
          consultationFee,
        },
      ],
      { session },
    );

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);

    await Subscription.create(
      [
        {
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

    return res
      .status(201)
      .json(
        new ApiResponse(201, createdUser, "Doctor registered successfully"),
      );
  } catch (error) {
    await session.abortTransaction();
    throw error instanceof ApiError
      ? error
      : new ApiError(
          500,
          error?.message || "Something went wrong while registering the doctor",
        );
  } finally {
    session.endSession();
  }
});

// registerPatient
const registerPatient = AsyncHandler(async (req, res) => {
  const { fullname, email, password, dateOfBirth, gender, bloodGroup } =
    req.body;

  if (
    [fullname, email, password, gender, bloodGroup].some(
      (field) => !field || field.trim() === "",
    )
  ) {
    throw new ApiError(400, "All fields are required");
  }

  if (!dateOfBirth) {
    throw new ApiError(400, "Date of birth is required");
  }

  const existedUser = await User.findOne({ email });
  if (existedUser) {
    throw new ApiError(409, "User with this email already exists");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const [user] = await User.create(
      [{ fullname, email, password, role: "patient" }],
      { session },
    );

    await Patient.create(
      [{ user: user._id, dateOfBirth, gender, bloodGroup }],
      { session },
    );

    await session.commitTransaction();

    const createdUser = await User.findById(user._id).select(
      "-password -refreshToken",
    );

    return res
      .status(201)
      .json(
        new ApiResponse(201, createdUser, "Patient registered successfully"),
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
});

// login

const login = AsyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }

  const user = await User.findOne({ email });
  if (!user) {
    throw new ApiError(404, "User does not exist");
  }

  const isPasswordValid = await user.isPasswordCorrect(password);
  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid credentials");
  }

  const { accessToken, refreshToken } =
    await generateAccessAndRefreshTokens(user);

  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken",
  );

  return res
    .status(200)
    .cookie("accessToken", accessToken, cookieOptions)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json(
      new ApiResponse(
        200,
        { user: loggedInUser, accessToken, refreshToken },
        "Logged in successfully",
      ),
    );
});


// refreshAccessToken
const refreshAccessToken = AsyncHandler(async (req, res) => {
  const incomingRefreshToken =
    req.cookies?.refreshToken || req.body?.refreshToken;

  if (!incomingRefreshToken) {
    throw new ApiError(401, "Unauthorized request");
  }

  let decodedToken;
  try {
    decodedToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET,
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
        "Access token refreshed successfully",
      ),
    );
});

// logout
const logout = AsyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id,
    { $set: { refreshToken: "" } },
    { new: true },
  );

  return res
    .status(200)
    .clearCookie("accessToken", cookieOptions)
    .clearCookie("refreshToken", cookieOptions)
    .json(new ApiResponse(200, {}, "Logged out successfully"));
});

// getCurrentUser
const getCurrentUser = AsyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(
      new ApiResponse(200, req.user, "Current user fetched successfully"),
    );
});

export {
  registerDoctor,
  registerPatient,
  login,
  refreshAccessToken,
  logout,
  getCurrentUser,
};