import jwt from "jsonwebtoken";
import { User } from "../models/user.models.js";
import ApiError from "../utils/apierror.js";

const verifyJWT = async (req, res, next) => {
  try {
    const token =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      throw new ApiError(401, "Unauthorized request");
    }

    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    // Admin lives in .env, not the DB — trust the token, skip the lookup.
    if (decodedToken.role === "admin") {
      req.user = {
        _id: decodedToken._id,
        email: decodedToken.email,
        role: "admin",
      };
      return next();
    }

    // Normal users: look up in DB as before.
    const user = await User.findById(decodedToken?._id).select(
      "-password -refreshToken",
    );

    if (!user) {
      throw new ApiError(401, "Invalid access token");
    }

    req.user = user;
    next();
  } catch (error) {
    next(new ApiError(401, error?.message || "Invalid access token"));
  }
};

export { verifyJWT };