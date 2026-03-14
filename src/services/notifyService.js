import nodemailer from "nodemailer";

const envVal = (primary, ...fallbacks) => {
  for (const key of [primary, ...fallbacks]) {
    if (process.env[key]) return process.env[key];
  }
  return "";
};

const getAdminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

const getSmtpConfig = () => {
  const host = envVal("SMTP_HOST", "MAIL_HOST");
  const portRaw = envVal("SMTP_PORT", "MAIL_PORT") || "587";
  const port = Number(portRaw);
  const user = envVal("SMTP_USER", "MAIL_USER");
  const pass = envVal("SMTP_PASS", "MAIL_PASS");
  const from = envVal("SMTP_FROM", "MAIL_FROM") || user;
  const secure =
    String(envVal("SMTP_SECURE")).toLowerCase() === "true" || port === 465;
  const timeoutMs = Number(envVal("SMTP_TIMEOUT_MS")) || 15000;
  return { host, port, user, pass, from, secure, timeoutMs };
};

const hasSmtpConfig = () => {
  const { host, port, user, pass, from } = getSmtpConfig();
  return Boolean(host && port && user && pass && from);
};

const buildTransport = () => {
  const { host, port, user, pass, secure, timeoutMs } = getSmtpConfig();
  return nodemailer.createTransport({
    host,
    port: Number(port || 587),
    secure,
    auth: { user, pass },
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });
};

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
      from: getSmtpConfig().from,
      to: recipients.join(","),
      subject,
      text,
    });
  } catch (err) {
    console.warn("Failed to send admin signup email:", err.message);
  }
};
