import sgMail from "@sendgrid/mail";

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export async function sendEmail(to, subject, html) {
  try {
    await sgMail.send({
      to,
      from: process.env.MAIL_FROM,
      subject,
      html,
    });
  } catch (err) {
    console.error("Email error:", err.response?.body || err.message);
    throw new Error("Email failed");
  }
}
