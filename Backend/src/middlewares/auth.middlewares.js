import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { User } from "../models/user.models.js";
import ApiError from "../utils/apierror.js";

const verifyJWT = async (req, res, next) => {
  console.log(">>> verifyJWT LOADED FROM auth.middleware.js — build check <<<"); // <-- ADD HERE

  try {
    const token =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      throw new ApiError(401, "Unauthorized request");
    }

    const decodedToken = jwt.verify(
      token,
      process.env.ACCESS_TOKEN_SECRET
    );

    console.log("DECODED TOKEN:", decodedToken);

    // Admin is not stored in User collection
    if (decodedToken.role === "admin") {
      req.user = {
        email: decodedToken.email,
        role: "admin",
      };

      return next();
    }

    // Normal users
    if (!mongoose.isValidObjectId(decodedToken._id)) {
      throw new ApiError(401, "Invalid access token");
    }

    const user = await User.findById(decodedToken._id).select(
      "-password -refreshToken"
    );

    if (!user) {
      throw new ApiError(401, "Invalid access token");
    }

    req.user = user;

    next();
  } catch (error) {
    console.log("VERIFY JWT ERROR:", error.message);

    if (error instanceof ApiError) {
      return next(error);
    }

    return next(new ApiError(401, "Invalid access token"));
  }
};

export { verifyJWT };