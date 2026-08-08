import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

/**
 * Send an email.
 * @param {string} to       
 * @param {string} subject
 * @param {string} html     
 */
export const sendEmail = async ({ to, subject, html }) => {
  await transporter.sendMail({
    from: `"PatientFlow" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
  });
};

// Small helper to build the OTP email body.
export const otpEmailTemplate = (otp) => `
  <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
    <h2>PatientFlow Password Reset</h2>
    <p>Use the code below to reset your password. It expires in 1 minutes.</p>
    <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${otp}</p>
    <p>If you didn't request this, you can safely ignore this email.</p>
  </div>
`;