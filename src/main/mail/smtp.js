'use strict';

const nodemailer = require('nodemailer');

const FONT_STACKS = {
  sans: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'SF Mono', Menlo, Consolas, monospace"
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Render plain text as a styled HTML email using the account template.
// The "-- " line separates the body from the signature block.
function buildHtml(text, t) {
  const font = FONT_STACKS[t.font] || FONT_STACKS.sans;
  const parts = String(text).split(/\n-- \n/);
  const body = escapeHtml(parts[0]).trimEnd();
  const sig = parts.length > 1 ? escapeHtml(parts.slice(1).join('\n-- \n')).trim() : '';
  const sigHtml = sig
    ? '<div style="margin-top:28px;padding-top:14px;border-top:2px solid ' + t.accent + ';' +
      'white-space:pre-wrap;opacity:0.85;">' + sig + '</div>'
    : '';
  return '<!doctype html><html><body style="margin:0;padding:28px 16px;background:' + t.bg + ';">' +
    '<div style="max-width:640px;margin:0 auto;background:' + t.card + ';border-radius:12px;' +
    'padding:30px 34px;font-family:' + font + ';color:' + t.text + ';font-size:15px;line-height:1.6;">' +
    '<div style="white-space:pre-wrap;">' + body + '</div>' + sigHtml +
    '</div></body></html>';
}

function transportFor(account, credentials) {
  return nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.security === 'ssl',
    requireTLS: account.smtp.security === 'starttls',
    auth: { user: credentials.user, pass: credentials.password }
  });
}

async function verify(account, credentials) {
  const transport = transportFor(account, credentials);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

async function send(account, credentials, message) {
  const transport = transportFor(account, credentials);
  try {
    const mail = {
      from: { name: account.name, address: account.email },
      to: message.to,
      cc: message.cc || undefined,
      bcc: message.bcc || undefined,
      subject: message.subject || '',
      text: message.text || '',
      html: account.template && account.template.styled
        ? buildHtml(message.text || '', account.template)
        : undefined,
      inReplyTo: message.inReplyTo || undefined,
      references: message.references || undefined,
      attachments: (message.attachments || []).map((a) => ({ filename: a.filename, path: a.path }))
    };
    const info = await transport.sendMail(mail);
    // Build the raw message again so it can be appended to the Sent folder.
    const composer = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const built = await composer.sendMail({ ...mail, messageId: info.messageId });
    return { messageId: info.messageId, raw: built.message };
  } finally {
    transport.close();
  }
}

module.exports = { verify, send };
