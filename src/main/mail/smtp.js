'use strict';

const nodemailer = require('nodemailer');

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
