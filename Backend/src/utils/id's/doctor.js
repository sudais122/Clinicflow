import generateSequentialId from "./Generatesequentialid.js";

export const generateDoctorId = (options) =>
  generateSequentialId("doctor", "DR", options);