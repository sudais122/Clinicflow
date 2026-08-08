import ApiError from "../utils/apierror.js";

const isAdmin = (req, res, next) => {
  try {
    if (!req.user) {
      throw new ApiError(401, "Unauthorized request");
    }
    if (req.user.role !== "admin") {
      throw new ApiError(403, "Admin access required");
    }
    next();
  } catch (error) {
    next(error);
  }
};

export { isAdmin };