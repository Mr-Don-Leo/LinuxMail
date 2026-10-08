'use strict';

const Pop3Command = require('node-pop3');
const { simpleParser } = require('mailparser');
const { serializeParsed } = require('./parse');

// POP3 has one mailbox and no server-side flags, so the app keeps a small
// local cache of parsed headers keyed by UIDL, refreshed on each sync.

const headerCache = new Map(); // accountId -> Map(uidl -> headerInfo)

function clientFor(account, credentials) {
  return new Pop3Command({
    user: credentials.user,
    password: credentials.password,
    host: account.incoming.host,
    port: account.incoming.port,
    tls: account.incoming.security === 'ssl',
    timeout: 30000
  });
}

async function verify(account, credentials) {
  const client = clientFor(account, credentials);
  try {
    await client.STAT();
  } finally {
    await client.QUIT().catch(() => {});
  }
}

async function listMailboxes() {
  return [{ path: 'INBOX', name: 'Inbox', specialUse: '\\Inbox', messages: null, unseen: null }];
}

// When searching, headers are fetched for at most this many newest messages.
const SEARCH_SCAN_LIMIT = 300;

async function headersFor(client, cache, msgNum, uid) {
  let info = cache.get(uid);
  if (info) return info;
  try {
    const top = await client.TOP(msgNum, 0);
    const parsed = await simpleParser(top);
    const from = parsed.from && parsed.from.value && parsed.from.value[0];
    info = {
      subject: parsed.subject || '(no subject)',
      from: from ? { name: from.name || '', address: from.address || '' } : null,
      date: parsed.date ? parsed.date.toISOString() : null
    };
  } catch (err) {
    info = { subject: '(unable to read headers)', from: null, date: null };
  }
  cache.set(uid, info);
  return info;
}

function toSummary(uid, msgNum, info) {
  return {
    uid,
    msgNum,
    subject: info.subject,
    from: info.from,
    date: info.date,
    seen: true, // POP3 has no read state; avoid showing everything as unread
    flagged: false,
    answered: false,
    hasAttachments: false,
    size: 0
  };
}

async function listMessages(account, credentials, _mailbox, offset = 0, limit = 30, query = '') {
  const client = clientFor(account, credentials);
  try {
    const uidl = await client.UIDL(); // [[msgNum, uidl], ...]
    const newestFirst = uidl.slice().reverse();

    let cache = headerCache.get(account.id);
    if (!cache) {
      cache = new Map();
      headerCache.set(account.id, cache);
    }

    if (query) {
      const q = query.toLowerCase();
      const matches = [];
      for (const [msgNum, uid] of newestFirst.slice(0, SEARCH_SCAN_LIMIT)) {
        const info = await headersFor(client, cache, msgNum, uid);
        const hay = [
          info.subject,
          info.from && info.from.name,
          info.from && info.from.address
        ].filter(Boolean).join(' ').toLowerCase();
        if (hay.includes(q)) matches.push(toSummary(uid, msgNum, info));
      }
      return { total: matches.length, messages: matches.slice(offset, offset + limit) };
    }

    const messages = [];
    for (const [msgNum, uid] of newestFirst.slice(offset, offset + limit)) {
      messages.push(toSummary(uid, msgNum, await headersFor(client, cache, msgNum, uid)));
    }
    return { total: uidl.length, messages };
  } finally {
    await client.QUIT().catch(() => {});
  }
}

async function resolveMsgNum(client, uid) {
  const uidl = await client.UIDL();
  const entry = uidl.find(([, u]) => u === uid);
  if (!entry) throw new Error('Message no longer on server');
  return entry[0];
}

async function fetchMessage(account, credentials, _mailbox, uid) {
  const client = clientFor(account, credentials);
  try {
    const msgNum = await resolveMsgNum(client, uid);
    const raw = await client.RETR(msgNum);
    const parsed = await simpleParser(raw);
    return serializeParsed(parsed);
  } finally {
    await client.QUIT().catch(() => {});
  }
}

async function fetchAttachment(account, credentials, _mailbox, uid, index) {
  const client = clientFor(account, credentials);
  try {
    const msgNum = await resolveMsgNum(client, uid);
    const raw = await client.RETR(msgNum);
    const parsed = await simpleParser(raw);
    const att = (parsed.attachments || [])[index];
    if (!att) throw new Error('Attachment not found');
    return { filename: att.filename || `attachment-${index + 1}`, content: att.content };
  } finally {
    await client.QUIT().catch(() => {});
  }
}

async function deleteMessage(account, credentials, _mailbox, uid) {
  const client = clientFor(account, credentials);
  try {
    const msgNum = await resolveMsgNum(client, uid);
    await client.DELE(msgNum);
    await client.QUIT(); // deletion is only committed on clean QUIT
    const cache = headerCache.get(account.id);
    if (cache) cache.delete(uid);
  } catch (err) {
    await client.QUIT().catch(() => {});
    throw err;
  }
}

module.exports = {
  verify,
  listMailboxes,
  listMessages,
  fetchMessage,
  fetchAttachment,
  deleteMessage
};
