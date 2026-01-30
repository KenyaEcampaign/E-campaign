import sgMail from "@sendgrid/mail";

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export async function sendEmail(to, subject, html) {
  await sgMail.send({
    to,
    from: process.env.EMAIL_FROM, // MUST be a STRING
    subject,
    html
  });
}
