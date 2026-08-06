import generateSequentialId from "./Generatesequentialid.js";

export const generateSubscriptionId = (options) =>
  generateSequentialId("subscription", "SUB", options);