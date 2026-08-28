/* ============================================================
   I don't have your original adminSubscription.controller.js — this
   is written fresh, matching the exact conventions already
   established in adminDoctor.controller.js (getPagination helper,
   ApiError + next(error), nested .populate for doctor.user). If a
   real version of this file already exists with different logic,
   diff against it before overwriting.

   This is the fix for two of your three reported bugs:
   - Doctor showing "-": the frontend already correctly reads
     s.doctor?.user?.fullname — it just had nothing to populate
     against. getSubscriptions below nested-populates doctor -> user.
   - Multiple "active subscriptions": not actually possible with your
     schema (Subscription.doctor has unique: true), so nothing to fix
     there structurally — this file just returns the ONE Subscription
     doc per doctor, correctly labeled.
   ============================================================ */

import { Subscription } from "../../models/subscription.models.js";
import ApiError from "../../utils/apierror.js";
import ApiResponse from "../../utils/ApiResponse.js";

const getPagination = (req) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// Same lazy-expiry-on-read derivation used in adminDoctor.controller.js's
// getDoctorDetails (and in subscription.controller.js's
// applyExpiryIfNeeded) — kept in sync by hand across all three.
// ADJUST: pull into one shared helper module instead.
function deriveStatus(subscription) {
  if (
    subscription.plan === "paid" &&
    subscription.status === "active" &&
    subscription.endDate &&
    new Date(subscription.endDate) < new Date()
  ) {
    return "expired";
  }
  return subscription.status;
}

function shapeSubscription(s) {
  return {
    subscriptionId: s.subscriptionId,
    doctor: {
      doctorId: s.doctor?.doctorId || null,
      clinicName: s.doctor?.clinicName || null,
      user: {
        fullname: s.doctor?.user?.fullname || null,
        email: s.doctor?.user?.email || null,
      },
    },
    plan: s.plan, // "free" | "paid" — the frontend maps "paid" -> "Practice" for display, never shows the raw word
    price: s.price,
    startDate: s.startDate,
    endDate: s.endDate,
    status: deriveStatus(s),
  };
}

// GET /admin/subscriptions?plan=&status=&page=&limit=
const getSubscriptions = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req);
    const { plan, status } = req.query;

    const filter = {};
    if (plan) {
      if (!["free", "paid"].includes(plan)) throw new ApiError(400, "Invalid plan filter");
      filter.plan = plan;
    }
    // status is filtered AFTER deriving live status (below), since an
    // "active"-stored doc can actually be expired — filtering on the
    // raw field would miss those.
    if (status && !["active", "expired", "cancelled"].includes(status)) {
      throw new ApiError(400, "Invalid status filter");
    }

    const [docs, total] = await Promise.all([
      Subscription.find(filter)
        .populate({
          path: "doctor",
          select: "doctorId clinicName user",
          populate: { path: "user", select: "fullname email" },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Subscription.countDocuments(filter),
    ]);

    let subscriptions = docs.map(shapeSubscription);
    if (status) {
      subscriptions = subscriptions.filter((s) => s.status === status);
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          subscriptions,
          pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        },
        "Subscriptions fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};

// GET /admin/subscriptions/:subscriptionId
const getSubscriptionDetails = async (req, res, next) => {
  try {
    const subscription = await Subscription.findOne({
      subscriptionId: req.params.subscriptionId,
    }).populate({
      path: "doctor",
      select: "doctorId clinicName user",
      populate: { path: "user", select: "fullname email" },
    });
    if (!subscription) throw new ApiError(404, "Subscription not found");

    return res
      .status(200)
      .json(new ApiResponse(200, shapeSubscription(subscription), "Subscription fetched"));
  } catch (error) {
    next(error);
  }
};

// PATCH /admin/subscriptions/:subscriptionId/extend   Body: { days }
const extendSubscription = async (req, res, next) => {
  try {
    const days = Number(req.body.days) || 30;
    const subscription = await Subscription.findOne({
      subscriptionId: req.params.subscriptionId,
    });
    if (!subscription) throw new ApiError(404, "Subscription not found");

    const now = new Date();
    const base =
      subscription.endDate && subscription.endDate > now
        ? new Date(subscription.endDate)
        : now;
    base.setDate(base.getDate() + days);
    subscription.endDate = base;
    subscription.status = "active";
    await subscription.save();

    return res.status(200).json(new ApiResponse(200, subscription, "Subscription extended"));
  } catch (error) {
    next(error);
  }
};

// PATCH /admin/subscriptions/:subscriptionId/plan   Body: { plan: "free" | "paid" }
// Manual admin override (e.g. comping a plan, or reverting a mistaken
// approval) — bypasses payment review, so keep this admin-only.
const setSubscriptionPlan = async (req, res, next) => {
  try {
    const { plan } = req.body;
    if (!["free", "paid"].includes(plan)) {
      throw new ApiError(400, "plan must be 'free' or 'paid'");
    }

    const subscription = await Subscription.findOne({
      subscriptionId: req.params.subscriptionId,
    });
    if (!subscription) throw new ApiError(404, "Subscription not found");

    subscription.plan = plan;
    subscription.status = "active";
    if (plan === "free") {
      subscription.price = 0;
    } else if (!subscription.endDate || subscription.endDate < new Date()) {
      subscription.startDate = new Date();
      const end = new Date();
      end.setDate(end.getDate() + 30);
      subscription.endDate = end;
    }
    await subscription.save();

    return res.status(200).json(new ApiResponse(200, subscription, "Plan updated"));
  } catch (error) {
    next(error);
  }
};

export { getSubscriptions, getSubscriptionDetails, extendSubscription, setSubscriptionPlan };