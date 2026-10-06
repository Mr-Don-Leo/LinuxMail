'use strict';

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

function clientFor(account, credentials) {
  return new ImapFlow({
    host: account.incoming.host,
    port: account.incoming.port,
    secure: account.incoming.security === 'ssl',
    auth: { user: credentials.user, pass: credentials.password },
    logger: false
  });
}

async function withClient(account, credentials, fn) {
  const client = clientFor(account, credentials);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

async function verify(account, credentials) {
  await withClient(account, credentials, async () => true);
}

const SPECIAL_ORDER = { '\\Inbox': 0, '\\Drafts': 1, '\\Sent': 2, '\\Archive': 3, '\\Junk': 4, '\\Trash': 5 };

async function listMailboxes(account, credentials) {
  return withClient(account, credentials, async (client) => {
    const boxes = await client.list({ statusQuery: { messages: true, unseen: true } });
    const mapped = boxes
      .filter((box) => !box.flags || !box.flags.has('\\Noselect'))
      .map((box) => ({
        path: box.path,
        name: box.name,
        specialUse: box.specialUse || (box.path.toUpperCase() === 'INBOX' ? '\\Inbox' : null),
        messages: box.status ? box.status.messages : null,
        unseen: box.status ? box.status.unseen : null
      }));
    mapped.sort((a, b) => {
      const ra = a.specialUse in SPECIAL_ORDER ? SPECIAL_ORDER[a.specialUse] : 9;
      const rb = b.specialUse in SPECIAL_ORDER ? SPECIAL_ORDER[b.specialUse] : 9;
      return ra !== rb ? ra - rb : a.path.localeCompare(b.path);
    });
    return mapped;
  });
}

async function listMessages(account, credentials, mailbox, offset = 0, limit = 50) {
  return withClient(account, credentials, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const total = client.mailbox.exists;
      if (!total) return { total: 0, messages: [] };

      // Newest messages have the highest sequence numbers.
      const end = total - offset;
      if (end < 1) return { total, messages: [] };
      const start = Math.max(1, end - limit + 1);

      const messages = [];
      for await (const msg of client.fetch(`${start}:${end}`, {
        uid: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
        size: true
      })) {
        const from = msg.envelope.from && msg.envelope.from[0];
        messages.push({
          uid: msg.uid,
          subject: msg.envelope.subject || '(no subject)',
          from: from ? { name: from.name || '', address: from.address || '' } : null,
          date: msg.envelope.date ? msg.envelope.date.toISOString() : null,
          seen: msg.flags.has('\\Seen'),
          flagged: msg.flags.has('\\Flagged'),
          answered: msg.flags.has('\\Answered'),
          hasAttachments: hasAttachmentParts(msg.bodyStructure),
          size: msg.size || 0
        });
      }
      messages.reverse(); // newest first
      return { total, messages };
    } finally {
      lock.release();
    }
  });
}

function hasAttachmentParts(node) {
  if (!node) return false;
  if (node.disposition === 'attachment') return true;
  if (Array.isArray(node.childNodes)) return node.childNodes.some(hasAttachmentParts);
  return false;
}

async function fetchMessage(account, credentials, mailbox, uid) {
  return withClient(account, credentials, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const { content } = await client.download(String(uid), undefined, { uid: true });
      const parsed = await simpleParser(content);
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      return serializeParsed(parsed);
    } finally {
      lock.release();
    }
  });
}

function serializeParsed(parsed) {
  return {
    subject: parsed.subject || '(no subject)',
    from: parsed.from ? parsed.from.text : '',
    to: parsed.to ? addressText(parsed.to) : '',
    cc: parsed.cc ? addressText(parsed.cc) : '',
    date: parsed.date ? parsed.date.toISOString() : null,
    messageId: parsed.messageId || null,
    inReplyTo: parsed.inReplyTo || null,
    references: parsed.references || null,
    html: typeof parsed.html === 'string' ? parsed.html : null,
    text: parsed.text || '',
    attachments: (parsed.attachments || []).map((att, i) => ({
      index: i,
      filename: att.filename || `attachment-${i + 1}`,
      contentType: att.contentType || 'application/octet-stream',
      size: att.size || (att.content ? att.content.length : 0)
    }))
  };
}

async function fetchAttachment(account, credentials, mailbox, uid, index) {
  return withClient(account, credentials, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const { content } = await client.download(String(uid), undefined, { uid: true });
      const parsed = await simpleParser(content);
      const att = (parsed.attachments || [])[index];
      if (!att) throw new Error('Attachment not found');
      return { filename: att.filename || `attachment-${index + 1}`, content: att.content };
    } finally {
      lock.release();
    }
  });
}

async function setFlag(account, credentials, mailbox, uid, flag, value) {
  const allowed = { seen: '\\Seen', flagged: '\\Flagged' };
  const imapFlag = allowed[flag];
  if (!imapFlag) throw new Error('Unsupported flag: ' + flag);
  return withClient(account, credentials, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      if (value) await client.messageFlagsAdd(String(uid), [imapFlag], { uid: true });
      else await client.messageFlagsRemove(String(uid), [imapFlag], { uid: true });
    } finally {
      lock.release();
    }
  });
}

async function deleteMessage(account, credentials, mailbox, uid) {
  return withClient(account, credentials, async (client) => {
    const boxes = await client.list();
    const trash = boxes.find((b) => b.specialUse === '\\Trash');
    const lock = await client.getMailboxLock(mailbox);
    try {
      if (trash && trash.path !== mailbox) {
        await client.messageMove(String(uid), trash.path, { uid: true });
      } else {
        await client.messageDelete(String(uid), { uid: true });
      }
    } finally {
      lock.release();
    }
  });
}

async function appendMessage(account, credentials, specialUse, raw, flags) {
  // Save a sent message into the account's Sent folder (if one exists).
  return withClient(account, credentials, async (client) => {
    const boxes = await client.list();
    const target = boxes.find((b) => b.specialUse === specialUse);
    if (!target) return false;
    await client.append(target.path, raw, flags || ['\\Seen']);
    return true;
  });
}

module.exports = {
  verify,
  listMailboxes,
  listMessages,
  fetchMessage,
  fetchAttachment,
  setFlag,
  deleteMessage,
  appendMessage
};
