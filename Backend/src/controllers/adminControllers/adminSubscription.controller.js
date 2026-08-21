import { Subscription } from "../../models/subscription.models.js";

import ApiError from "../../utils/apierror.js";
import ApiResponse from "../../utils/apiresponse.js";

const getPagination = (req) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const deriveStatus = (sub) => {
  if (sub.status === "cancelled") return "cancelled";
  if (sub.plan === "paid" && sub.endDate && new Date(sub.endDate) < new Date()) {
    return "expired";
  }
  return sub.status;
};

const getSubscriptions = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req);
    const { plan, status } = req.query;

    const filter = {};
    if (plan) {
      if (!["free", "paid"].includes(plan)) throw new ApiError(400, "Invalid plan filter");
      filter.plan = plan;
    }
    if (status) {
      if (!["active", "expired", "cancelled"].includes(status)) {
        throw new ApiError(400, "Invalid status filter");
      }
      filter.status = status;
    }

    const [subscriptions, total] = await Promise.all([
      Subscription.find(filter)
        .populate({
          path: "doctor",
          select: "doctorId clinicName user",
          populate: { path: "user", select: "fullname" },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Subscription.countDocuments(filter),
    ]);

    const withLiveStatus = subscriptions.map((s) => ({ ...s, liveStatus: deriveStatus(s) }));

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          subscriptions: withLiveStatus,
          pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        },
        "Subscriptions fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};

const getSubscriptionDetails = async (req, res, next) => {
  try {
    const sub = await Subscription.findOne({ subscriptionId: req.params.subscriptionId }).populate(
      {
        path: "doctor",
        select: "doctorId clinicName user",
        populate: { path: "user", select: "fullname" },
      },
    );
    if (!sub) throw new ApiError(404, "Subscription not found");

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          doctor: { doctorId: sub.doctor?.doctorId, name: sub.doctor?.user?.fullname },
          plan: sub.plan,
          price: sub.price,
          startDate: sub.startDate,
          endDate: sub.endDate,
          status: deriveStatus(sub),
        },
        "Subscription details fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};

const extendSubscription = async (req, res, next) => {
  try {
    const { days } = req.body;
    if (!days || isNaN(days) || Number(days) <= 0) {
      throw new ApiError(400, "days must be a positive number");
    }

    const sub = await Subscription.findOne({ subscriptionId: req.params.subscriptionId });
    if (!sub) throw new ApiError(404, "Subscription not found");

    const base = sub.endDate && new Date(sub.endDate) > new Date() ? new Date(sub.endDate) : new Date();
    base.setDate(base.getDate() + Number(days));

    sub.endDate = base;
    if (sub.status === "expired") sub.status = "active";
    await sub.save();

    return res
      .status(200)
      .json(new ApiResponse(200, { endDate: sub.endDate, status: sub.status }, "Subscription extended"));
  } catch (error) {
    next(error);
  }
};

const changeSubscriptionPlan = async (req, res, next) => {
  try {
    const { plan, price } = req.body;
    if (!["free", "paid"].includes(plan)) {
      throw new ApiError(400, "plan must be 'free' or 'paid'");
    }

    const sub = await Subscription.findOne({ subscriptionId: req.params.subscriptionId });
    if (!sub) throw new ApiError(404, "Subscription not found");

    sub.plan = plan;
    if (plan === "free") {
      sub.price = 0;
    } else if (price !== undefined) {
      if (isNaN(price) || Number(price) < 0) throw new ApiError(400, "Invalid price");
      sub.price = Number(price);
    }
    await sub.save();

    return res
      .status(200)
      .json(new ApiResponse(200, { plan: sub.plan, price: sub.price }, "Subscription plan updated"));
  } catch (error) {
    next(error);
  }
};

export { getSubscriptions, getSubscriptionDetails, extendSubscription, changeSubscriptionPlan };