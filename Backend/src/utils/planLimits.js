const FREE_PLAN_DAILY_TOKEN_LIMIT = 25;
function isUnlimitedPlan(subscription) {
  return !!subscription && subscription.plan === "paid" && subscription.status === "active";
}

export { FREE_PLAN_DAILY_TOKEN_LIMIT, isUnlimitedPlan };