import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const sendEmail = async ({ to, subject, html }) => {
  if (!to || !subject || !html) {
    throw new Error("sendEmail requires to, subject, and html");
  }

  await transporter.sendMail({
    from: `"ClinicFlow" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
  });
};

export { sendEmail };