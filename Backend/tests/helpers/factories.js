import { User } from "../../src/models/user.models.js";
import { Doctor } from "../../src/models/doctor.models.js";
import { Patient } from "../../src/models/patient.models.js";
import { Admin } from "../../src/models/admin.models.js";
import { Subscription } from "../../src/models/subscription.models.js";
import { Appointment } from "../../src/models/appointment.models.js";
import { Report } from "../../src/models/report.models.js";
import { Queue } from "../../src/models/queue.models.js";

let seq = 0;
const next = () => (seq += 1);

export const createAdmin = async (overrides = {}) => {
  const n = next();
  return Admin.create({
    fullname: `Admin ${n}`,
    email: `admin${n}@test.com`,
    password: "Password1!",
    ...overrides,
  });
};

export const createDoctorUser = async (overrides = {}) => {
  const n = next();
  const user = await User.create({
    fullname: `Dr. Test ${n}`,
    email: `doctor${n}@test.com`,
    password: "Password1!",
    phone: `030012345${String(n).padStart(2, "0")}`,
    role: "doctor",
    isActive: true,
    ...overrides.user,
  });
  const doctor = await Doctor.create({
    user: user._id,
    doctorId: `DR-${String(n).padStart(6, "0")}`,
    clinicName: `Clinic ${n}`,
    clinicAddress: `123 Test Street, City ${n}`,
    specialization: "Cardiology",
    licenseNumber: `LIC-${String(n).padStart(6, "0")}`,
    experience: 5,
    consultationFee: 1000,
    status: "pending",
    ...overrides.doctor,
  });
  return { user, doctor };
};

export const createPatientUser = async (overrides = {}) => {
  const n = next();
  const user = await User.create({
    fullname: `Patient Test ${n}`,
    email: `patient${n}@test.com`,
    password: "Password1!",
    phone: `031012345${String(n).padStart(2, "0")}`,
    role: "patient",
    isActive: true,
    ...overrides.user,
  });
  const patient = await Patient.create({
    user: user._id,
    patientId: `PAT-${String(n).padStart(6, "0")}`,
    dateOfBirth: new Date("1995-01-01"),
    gender: "male",
    bloodGroup: "O+",
    ...overrides.patient,
  });
  return { user, patient };
};

export const createSubscription = async (doctorId, overrides = {}) => {
  const n = next();
  return Subscription.create({
    subscriptionId: `SUB-${String(n).padStart(6, "0")}`,
    doctor: doctorId,
    plan: "free",
    price: 0,
    status: "active",
    startDate: new Date(),
    endDate: null,
    ...overrides,
  });
};

export const createQueue = async (doctorId, overrides = {}) => {
  return Queue.create({ doctor: doctorId, clinicStatus: "closed", nowServing: 0, lastToken: 0, ...overrides });
};

export const createAppointment = async (doctorId, patientId, bookedByUserId, overrides = {}) => {
  const n = next();
  return Appointment.create({
    appointmentId: `APT-${String(n).padStart(6, "0")}`,
    doctor: doctorId,
    patient: patientId,
    bookedBy: bookedByUserId,
    patientName: `Patient ${n}`,
    patientPhone: `0300123456${n % 10}`,
    appointmentDate: new Date(),
    tokenNumber: n,
    status: "waiting",
    ...overrides,
  });
};

export const createReport = async (userId, role, overrides = {}) => {
  return Report.create({
    user: userId,
    role,
    message: "Something is not working as expected on the platform.",
    status: "pending",
    ...overrides,
  });
};
