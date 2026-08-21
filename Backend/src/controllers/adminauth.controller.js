import { Admin } from "../models/admin.models.js";
import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";

const isProd = process.env.NODE_ENV === "production";
const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
};

const adminLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ApiError(400, "Email and password are required");
    }

    const admin = await Admin.findOne({ email: email.toLowerCase().trim() });

    if (!admin) {
      throw new ApiError(401, "Invalid admin credentials");
    }

    const passwordMatches = await admin.isPasswordCorrect(password);
    if (!passwordMatches) {
      throw new ApiError(401, "Invalid admin credentials");
    }

    if (admin.isActive === false) {
      throw new ApiError(403, "This admin account has been deactivated");
    }

    const accessToken = admin.generateAccessToken();
    const refreshToken = admin.generateRefreshToken();

    admin.refreshToken = refreshToken;
    await admin.save({ validateBeforeSave: false });

    return res
      .status(200)
      .cookie("accessToken", accessToken, cookieOptions)
      .cookie("refreshToken", refreshToken, cookieOptions)
      .json(
        new ApiResponse(
          200,
          {
            admin: {
              _id: admin._id,
              fullname: admin.fullname,
              email: admin.email,
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

const adminLogout = async (req, res, next) => {
  try {
    await Admin.findByIdAndUpdate(req.user._id, { $set: { refreshToken: "" } });

    return res
      .status(200)
      .clearCookie("accessToken", cookieOptions)
      .clearCookie("refreshToken", cookieOptions)
      .json(new ApiResponse(200, {}, "Admin logged out successfully"));
  } catch (error) {
    next(error);
  }
};

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