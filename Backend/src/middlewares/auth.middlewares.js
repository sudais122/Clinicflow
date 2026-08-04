import jwt from "jsonwebtoken";
import { User } from "../models/user.models.js";
import { ApiError } from "../utils/Apierror.js";

const verifyJWT = async (req, res, next) => {
  try {
    const token =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      throw new ApiError(401, "Unauthorized request");
    }

    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    // Admin lives in .env, not in the database — no lookup to do
    if (decodedToken.role === "admin") {
      req.user = { role: "admin", email: decodedToken.email };
      return next();
    }

    const user = await User.findById(decodedToken?._id).select(
      "-password -refreshtoken"
    );

    if (!user) {
      throw new ApiError(401, "Invalid Access Token");
    }

    req.user = user;
    next();
  } catch (error) {
    next(new ApiError(401, error?.message || "Invalid Access Token"));
  }
};

export { verifyJWT };