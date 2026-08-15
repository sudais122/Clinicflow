import nodemailer from "nodemailer";

let transporter;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.SMPT_USER,
        pass: process.env.SMPT_PASS,
      },
    });
  }
  return transporter;
};

export const sendEmail = async ({ to, subject, html }) => {
  // temporary debug — remove once it works
  console.log("GMAIL_USER:", process.env.SMPT_USER);
  console.log("GMAIL_APP_PASSWORD set?:", !!process.env.SMPT_PASS);

  await getTransporter().sendMail({
    from: `"PatientFlow" <${process.env.SMPT_USER}>`,
    to,
    subject,
    html,
  });
};

export const otpEmailTemplate = (otp) => `
  <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
    <h2>PatientFlow Password Reset</h2>
    <p>Use the code below to reset your password. It expires in 1 minute.</p>
    <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${otp}</p>
    <p>If you didn't request this, you can safely ignore this email.</p>
  </div>
`;