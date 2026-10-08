'use strict';

// Per-account disk cache (userData/cache/<accountId>.json) so the UI can
// render the last known mailboxes, message lists and message bodies
// instantly while fresh data loads ("stale-while-revalidate").

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const LIST_CAP = 90;    // summaries kept per mailbox
const BODY_CAP = 60;    // parsed bodies kept per account (LRU)

const loaded = new Map(); // accountId -> { data, timer }

function cacheDir() {
  return path.join(app.getPath('userData'), 'cache');
}

function fileFor(accountId) {
  return path.join(cacheDir(), accountId + '.json');
}

function entry(accountId) {
  let e = loaded.get(accountId);
  if (!e) {
    let data = null;
    try {
      data = JSON.parse(fs.readFileSync(fileFor(accountId), 'utf8'));
    } catch (_) { /* no cache yet */ }
    if (!data || typeof data !== 'object') data = {};
    data.mailboxes = data.mailboxes || null;
    data.lists = data.lists || {};
    data.bodies = data.bodies || {};
    data.bodyOrder = data.bodyOrder || [];
    e = { data, timer: null };
    loaded.set(accountId, e);
  }
  return e;
}

function scheduleSave(accountId) {
  const e = entry(accountId);
  if (e.timer) return;
  e.timer = setTimeout(() => {
    e.timer = null;
    try {
      fs.mkdirSync(cacheDir(), { recursive: true });
      const tmp = fileFor(accountId) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(e.data), { mode: 0o600 });
      fs.renameSync(tmp, fileFor(accountId));
    } catch (err) {
      console.error('Cache save failed:', err.message);
    }
  }, 400);
}

/* ---------- mailboxes ---------- */

function getMailboxes(accountId) {
  return entry(accountId).data.mailboxes;
}

function setMailboxes(accountId, mailboxes) {
  entry(accountId).data.mailboxes = mailboxes;
  scheduleSave(accountId);
}

/* ---------- message lists (unfiltered lists only) ---------- */

function getList(accountId, mailbox) {
  return entry(accountId).data.lists[mailbox] || null;
}

function setList(accountId, mailbox, total, messages) {
  entry(accountId).data.lists[mailbox] = {
    total,
    messages: messages.slice(0, LIST_CAP),
    ts: Date.now()
  };
  scheduleSave(accountId);
}

function extendList(accountId, mailbox, total, moreMessages) {
  const list = entry(accountId).data.lists[mailbox];
  if (!list) return;
  const seen = new Set(list.messages.map((m) => m.uid));
  for (const m of moreMessages) {
    if (!seen.has(m.uid) && list.messages.length < LIST_CAP) list.messages.push(m);
  }
  list.total = total;
  scheduleSave(accountId);
}

function markSeen(accountId, mailbox, uid) {
  const list = entry(accountId).data.lists[mailbox];
  if (!list) return;
  const msg = list.messages.find((m) => m.uid === uid);
  if (msg) {
    msg.seen = true;
    scheduleSave(accountId);
  }
}

function removeMessage(accountId, mailbox, uid) {
  const data = entry(accountId).data;
  const list = data.lists[mailbox];
  if (list) {
    const before = list.messages.length;
    list.messages = list.messages.filter((m) => m.uid !== uid);
    if (list.messages.length !== before && list.total > 0) list.total -= 1;
  }
  delete data.bodies[mailbox + '\u0000' + uid];
  data.bodyOrder = data.bodyOrder.filter((k) => k !== mailbox + '\u0000' + uid);
  scheduleSave(accountId);
}

/* ---------- parsed bodies ---------- */

function getBody(accountId, mailbox, uid) {
  const data = entry(accountId).data;
  return data.bodies[mailbox + '\u0000' + uid] || null;
}

function setBody(accountId, mailbox, uid, parsed) {
  const data = entry(accountId).data;
  const key = mailbox + '\u0000' + uid;
  if (!data.bodies[key]) {
    data.bodyOrder.push(key);
    while (data.bodyOrder.length > BODY_CAP) {
      delete data.bodies[data.bodyOrder.shift()];
    }
  }
  data.bodies[key] = parsed;
  scheduleSave(accountId);
}

/* ---------- lifecycle ---------- */

function clearAccount(accountId) {
  loaded.delete(accountId);
  try { fs.unlinkSync(fileFor(accountId)); } catch (_) { /* absent */ }
}

module.exports = {
  getMailboxes,
  setMailboxes,
  getList,
  setList,
  extendList,
  markSeen,
  removeMessage,
  getBody,
  setBody,
  clearAccount
};
