/* ============================================================
   I don't have your original subscription.controller.js — this was
   written fresh to satisfy the four named exports your existing
   subscription.routes.js already imports (getMySubscription,
   upgradeSubscription, renewSubscription, cancelSubscription). If a
   real version of this file already exists with different logic,
   diff against it before overwriting — getMySubscription's
   lazy-expiry check is the piece that actually matters for the
   dashboard fix; the other three are reasonable stand-ins, not
   verified against your real business rules.
   ============================================================ */

import { Subscription } from "../models/subscription.models.js"; // ADJUST path if different
import ApiResponse from "../utils/apiresponse.js"; // ADJUST if this lives elsewhere

// Duplicated from payment.controller.js's SUBSCRIPTION_DAYS — ADJUST
// to import both from one shared constants module instead.
const SUBSCRIPTION_DAYS = 30;

// Flips an active-but-past-endDate subscription to status:"expired"
// the moment anyone reads it, instead of needing a cron job. Mutates
// and persists the doc if it changed.
async function applyExpiryIfNeeded(subscription) {
  if (!subscription) return subscription;
  if (
    subscription.plan === "paid" &&
    subscription.status === "active" &&
    subscription.endDate &&
    subscription.endDate < new Date()
  ) {
    subscription.status = "expired";
    await subscription.save();
  }
  return subscription;
}

// GET /subscription/me  (doctor)
const getMySubscription = async (req, res) => {
  try {
    const doctorId = req.user._id;
    let subscription = await Subscription.findOne({ doctor: doctorId });

    if (!subscription) {
      // No Subscription doc at all — treat as an implicit Free plan
      // rather than 404ing, so the dashboard always has something
      // valid to render (per the "never fall back to a hardcoded
      // Free on error" rule — this isn't an error, it's a real
      // absence of a paid subscription). Not persisted; if every
      // doctor gets a Subscription doc at registration in your real
      // flow, this branch should rarely run.
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            {
              plan: "free",
              price: 0,
              status: "active",
              startDate: null,
              endDate: null,
            },
            "No subscription on record — defaulting to Free.",
          ),
        );
    }

    subscription = await applyExpiryIfNeeded(subscription);

    return res
      .status(200)
      .json(new ApiResponse(200, subscription, "Your subscription"));
  } catch (error) {
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};

// PATCH /subscription/upgrade  (doctor)
// In this app, upgrading to paid Practice requires an admin-approved
// payment proof (see payment.controller.js submitPayment /
// approvePayment) — that's the real activation path. This endpoint
// intentionally refuses to instantly grant a paid plan without one,
// so it can't be used to bypass payment review.
const upgradeSubscription = async (req, res) => {
  return res
    .status(400)
    .json(
      new ApiResponse(
        400,
        null,
        "Upgrading to Practice requires submitting a payment proof for admin review — use POST /payments instead.",
      ),
    );
};

// PATCH /subscription/renew  (doctor)
// Same reasoning as upgradeSubscription — renewing/extending Practice
// also goes through a new approved payment (approvePayment's
// extension logic), not a free self-service renewal.
const renewSubscription = async (req, res) => {
  return res
    .status(400)
    .json(
      new ApiResponse(
        400,
        null,
        "Renewing Practice requires submitting a payment proof for admin review — use POST /payments instead.",
      ),
    );
};

// PATCH /subscription/cancel  (doctor)
// Self-service downgrade to Free. Doesn't touch Payment records —
// just stops the current paid period from being treated as active.
// ADJUST: decide whether this should also clear startDate/endDate or
// leave them as history; this leaves them and only flips plan/status.
const cancelSubscription = async (req, res) => {
  try {
    const doctorId = req.user._id;
    const subscription = await Subscription.findOneAndUpdate(
      { doctor: doctorId },
      { $set: { plan: "free", status: "cancelled" } },
      { new: true },
    );
    if (!subscription) {
      return res
        .status(404)
        .json(new ApiResponse(404, null, "No subscription found"));
    }
    return res
      .status(200)
      .json(new ApiResponse(200, subscription, "Subscription cancelled"));
  } catch (error) {
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};

export {
  getMySubscription,
  upgradeSubscription,
  renewSubscription,
  cancelSubscription,
};
