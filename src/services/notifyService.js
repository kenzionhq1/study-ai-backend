import nodemailer from "nodemailer";

const getAdminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

const hasSmtpConfig = () =>
  process.env.SMTP_HOST &&
  process.env.SMTP_PORT &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS &&
  process.env.SMTP_FROM;

const buildTransport = () =>
  nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

export const sendAdminSignupNotification = async (user) => {
  const recipients = getAdminEmails();
  if (!recipients.length) return;
  if (!hasSmtpConfig()) {
    console.info("Signup notification skipped: SMTP not configured");
    return;
  }

  const transporter = buildTransport();
  const subject = `New signup: ${user.email}`;
  const text = `A new user just signed up.\n\nName: ${user.name || "N/A"}\nEmail: ${
    user.email
  }\nWhen: ${new Date().toISOString()}`;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: recipients.join(","),
      subject,
      text,
    });
  } catch (err) {
    console.warn("Failed to send admin signup email:", err.message);
  }
};
