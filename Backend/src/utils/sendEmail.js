import nodemailer from "nodemailer";

export async function sendEmail({ to, subject, html }) {
  console.log("=== sendEmail called ===");
  console.log("GMAIL_USER:", process.env.GMAIL_USER);
console.log("APP_PASSWORD length:", process.env.GMAIL_APP_PASSWORD?.length);
  console.log("To:", to);

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

    console.log("Email sent:", data.messageId);
    return { success: true, data };
  } catch (err) {
    console.error("Email failed:", err.message);
    return { success: false, error: err.message };
  }
}