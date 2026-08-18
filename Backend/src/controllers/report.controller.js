import { Report } from "../models/report.models.js";
import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";

// POST /support/report  
const submitReport = async (req, res, next) => {
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      throw new ApiError(400, "Please describe the problem before submitting");
    }

    const trimmed = message.trim();

    if (trimmed.length < 5) {
      throw new ApiError(400, "Please provide a bit more detail");
    }
    if (trimmed.length > 1000) {
      throw new ApiError(400, "Report must be under 1000 characters");
    }

    const report = await Report.create({
      user: req.user._id,
      role: req.user.role,
      message: trimmed,
    });

    return res
      .status(201)
      .json(new ApiResponse(201, report, "Report submitted successfully"));
  } catch (error) {
    next(error);
  }
};

// GET /support/report/me  
const getMyReports = async (req, res, next) => {
  try {
    const reports = await Report.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    return res
      .status(200)
      .json(new ApiResponse(200, reports, "Your reports fetched"));
  } catch (error) {
    next(error);
  }
};

export { submitReport, getMyReports };