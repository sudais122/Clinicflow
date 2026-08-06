import generateSequentialId from "./Generatesequentialid.js";

export const generateAppointmentId = (options) =>
  generateSequentialId("appointment", "APT", options);