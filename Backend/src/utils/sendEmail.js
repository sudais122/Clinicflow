import nodemailer from "nodemailer";

export async function sendEmail({ to, subject, html }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  try {
    const data = await transporter.sendMail({
      from: `"Clinic Flow" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html,
    });

    return { success: true, data };
  } catch (err) {
    console.error("Email failed:", err.message);
    // Throw instead of returning a failure object — issueOtp() in
    // Forgotpassword.controller.js awaits sendEmail() without
    // checking a return value, so a swallowed failure here means
    // forgotPassword/resendOtp would respond 200 "code sent" to the
    // frontend even when no email actually went out.
    throw new Error(
      "Could not send the email. Please try again in a moment.",
    );
  }
}