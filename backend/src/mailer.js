const nodemailer = require('nodemailer');

let transporter = null;

function getConfig() {
  return {
    user: process.env.GMAIL_USER || '',
    pass: process.env.GMAIL_APP_PASSWORD || '',
    appUrl: process.env.APP_URL || 'http://localhost:5173',
  };
}

function isMailConfigured() {
  const { user, pass } = getConfig();
  return Boolean(user && pass);
}

function getTransporter() {
  if (!transporter && isMailConfigured()) {
    const { user, pass } = getConfig();
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
  }
  return transporter;
}

async function notifySigner(signerEmail, signerName, documentTitle, documentId) {
  const transport = getTransporter();
  if (!transport) {
    console.log('[Mailer] Gmail not configured — skipping notification.');
    return;
  }

  const { user, appUrl } = getConfig();
  const link = `${appUrl}?doc=${documentId}`;

  await transport.sendMail({
    from: `"Document Signing System" <${user}>`,
    to: signerEmail,
    subject: `Action Required: Sign "${documentTitle}"`,
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1f2937; margin-bottom: 8px;">Document Awaiting Your Signature</h2>
        <p style="color: #374151; font-size: 15px;">Hi ${signerName},</p>
        <p style="color: #374151; font-size: 15px;">
          A document titled <strong>"${documentTitle}"</strong> has been forwarded to you and is waiting for your review and signature.
        </p>
        <a href="${link}" style="display: inline-block; background: #1b56fd; color: #fff; text-decoration: none; padding: 10px 22px; border-radius: 8px; font-size: 15px; margin: 16px 0;">
          Review &amp; Sign Document
        </a>
        <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
          — Hierarchical Document Signing System
        </p>
      </div>
    `,
  });

  console.log(`[Mailer] Notification sent to ${signerEmail} for document "${documentTitle}".`);
}

module.exports = { notifySigner, isMailConfigured };
