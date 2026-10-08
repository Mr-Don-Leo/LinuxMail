'use strict';

const nodemailer = require('nodemailer');
const { buildSignatureHtml, escapeHtml } = require('../signature');

const FONT_STACKS = {
  sans: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'SF Mono', Menlo, Consolas, monospace"
};

// Render plain text as a styled HTML email using the account template.
// The "-- " line separates the typed body from the signature block; the
// signature itself is re-rendered from the structured template fields.
function buildHtml(text, t, logoSrc) {
  const font = FONT_STACKS[t.font] || FONT_STACKS.sans;
  const body = escapeHtml(String(text).split(/\n-- \n/)[0]).trimEnd();
  const sigInner = buildSignatureHtml(t, logoSrc);
  const sigHtml = sigInner
    ? '<div style="margin-top:28px;padding-top:14px;border-top:2px solid ' + t.accent + ';' +
      'opacity:0.92;">' + sigInner + '</div>'
    : '';
  return '<!doctype html><html><body style="margin:0;padding:28px 16px;background:' + t.bg + ';">' +
    '<div style="max-width:640px;margin:0 auto;background:' + t.card + ';border-radius:12px;' +
    'padding:30px 34px;font-family:' + font + ';color:' + t.text + ';font-size:15px;line-height:1.6;">' +
    '<div style="white-space:pre-wrap;">' + body + '</div>' + sigHtml +
    '</div></body></html>';
}

const LOGO_CID = 'sig-logo@linuxmail';

function logoAttachment(t) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(t.sigLogo || '');
  if (!m) return null;
  return {
    filename: 'logo.' + m[1].split('/')[1].replace('jpeg', 'jpg'),
    content: Buffer.from(m[2], 'base64'),
    contentType: m[1],
    cid: LOGO_CID,
    contentDisposition: 'inline'
  };
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
    const styled = account.template && account.template.styled;
    const logo = styled ? logoAttachment(account.template) : null;
    const attachments = (message.attachments || []).map((a) => ({ filename: a.filename, path: a.path }));
    if (logo) attachments.push(logo);
    const mail = {
      from: { name: account.name, address: account.email },
      to: message.to,
      cc: message.cc || undefined,
      bcc: message.bcc || undefined,
      subject: message.subject || '',
      text: message.text || '',
      html: styled
        ? buildHtml(message.text || '', account.template, logo ? 'cid:' + LOGO_CID : null)
        : undefined,
      inReplyTo: message.inReplyTo || undefined,
      references: message.references || undefined,
      attachments
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
