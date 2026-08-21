import { Report } from "../../models/report.models.js";

import ApiError from "../../utils/apierror.js";
import ApiResponse from "../../utils/apiresponse.js";

const getPagination = (req) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const getProblemReports = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req);
    const { status } = req.query;

    const filter = {};
    if (status) {
      if (!["pending", "inreview", "resolved"].includes(status)) {
        throw new ApiError(400, "Invalid status filter");
      }
      filter.status = status;
    }

    const [reports, total] = await Promise.all([
      Report.find(filter)
        .populate({ path: "user", select: "fullname email" })
        .select("user role message status createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Report.countDocuments(filter),
    ]);

    const formatted = reports.map((r) => ({
      reportId: r._id,
      reportedBy: { name: r.user?.fullname, email: r.user?.email, role: r.role },
      subject: r.message?.slice(0, 60),
      status: r.status,
      createdAt: r.createdAt,
    }));

    return res.status(200).json(
      new ApiResponse(
        200,
        { reports: formatted, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
        "Problem reports fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};

const getProblemReportDetails = async (req, res, next) => {
  try {
    const report = await Report.findById(req.params.reportId).populate({
      path: "user",
      select: "fullname email",
    });
    if (!report) throw new ApiError(404, "Report not found");

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          reportId: report._id,
          reporter: report.user?.fullname,
          email: report.user?.email,
          role: report.role,
          message: report.message,
          status: report.status,
          resolution: report.resolution,
          createdAt: report.createdAt,
        },
        "Report details fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};

const moveReportToReview = async (req, res, next) => {
  try {
    const report = await Report.findById(req.params.reportId);
    if (!report) throw new ApiError(404, "Report not found");
    if (report.status === "resolved") throw new ApiError(400, "Report already resolved");

    report.status = "inreview";
    await report.save();

    return res
      .status(200)
      .json(new ApiResponse(200, { status: report.status }, "Report moved to review"));
  } catch (error) {
    next(error);
  }
};

const resolveProblemReport = async (req, res, next) => {
  try {
    const { resolution } = req.body;
    if (!resolution || !resolution.trim()) {
      throw new ApiError(400, "resolution is required");
    }

    const report = await Report.findById(req.params.reportId);
    if (!report) throw new ApiError(404, "Report not found");

    report.status = "resolved";
    report.resolution = resolution.trim();
    await report.save();

    return res
      .status(200)
      .json(new ApiResponse(200, { status: report.status }, "Report resolved"));
  } catch (error) {
    next(error);
  }
};

export { getProblemReports, getProblemReportDetails, moveReportToReview, resolveProblemReport };