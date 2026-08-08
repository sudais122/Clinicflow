import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";

const cookieOptions = {
  httpOnly: true,
  secure: true,
};


const generateAdminAccessToken = () =>
  jwt.sign(
    {
      _id: process.env.ADMIN_ID || "admin",
      email: process.env.ADMIN_EMAIL,
      role: "admin",
    },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRY },
  );

const generateAdminRefreshToken = () =>
  jwt.sign(
    {
      _id: process.env.ADMIN_ID || "admin",
      role: "admin",
    },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRY },
  );

// POST /admin/login
const adminLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ApiError(400, "Email and password are required");
    }

    if (
      !process.env.ADMIN_EMAIL ||
      !process.env.ADMIN_PASSWORD_HASH
    ) {
      throw new ApiError(500, "Admin credentials are not configured");
    }

    const emailMatches =
      email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();

    const passwordMatches = await bcrypt.compare(
      password,
      process.env.ADMIN_PASSWORD_HASH,
    );

    // Same generic error for either miss (don't reveal which was wrong).
    if (!emailMatches || !passwordMatches) {
      throw new ApiError(401, "Invalid admin credentials");
    }

    const accessToken = generateAdminAccessToken();
    const refreshToken = generateAdminRefreshToken();

    return res
      .status(200)
      .cookie("accessToken", accessToken, cookieOptions)
      .cookie("refreshToken", refreshToken, cookieOptions)
      .json(
        new ApiResponse(
          200,
          {
            admin: {
              _id: process.env.ADMIN_ID || "admin",
              email: process.env.ADMIN_EMAIL,
              role: "admin",
            },
            accessToken,
            refreshToken,
          },
          "Admin logged in successfully",
        ),
      );
  } catch (error) {
    next(error);
  }
};

// POST /admin/logout
const adminLogout = async (req, res, next) => {
  try {
    return res
      .status(200)
      .clearCookie("accessToken", cookieOptions)
      .clearCookie("refreshToken", cookieOptions)
      .json(new ApiResponse(200, {}, "Admin logged out successfully"));
  } catch (error) {
    next(error);
  }
};

// GET /admin/me 
const getCurrentAdmin = async (req, res, next) => {
  try {
    return res
      .status(200)
      .json(new ApiResponse(200, req.user, "Current admin fetched"));
  } catch (error) {
    next(error);
  }
};

export { adminLogin, adminLogout, getCurrentAdmin };