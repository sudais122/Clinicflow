import generateSequentialId from "./Generatesequentialid.js";

export const generatePatientId = (options) =>
  generateSequentialId("patient", "PT", options);