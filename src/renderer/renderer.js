'use strict';

/* global mailApi */

const PAGE_SIZE = 30;

const state = {
  accounts: [],
  mailboxes: {},          // accountId -> mailbox list
  current: null,          // { accountId, mailbox }
  offset: 0,
  total: 0,
  query: '',
  loadingMore: false,
  loadToken: 0,
  openToken: 0,
  messages: [],
  selected: null,         // { uid, flagged }
  composeContext: null,   // { inReplyTo, references, quote } when replying
  attachments: []         // compose attachments
};

const $ = (id) => document.getElementById(id);

/* ---------- helpers ---------- */

function toast(text, isError) {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('error', Boolean(isError));
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, isError ? 6000 : 3000);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString();
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function folderIcon(specialUse) {
  switch (specialUse) {
    case '\\Inbox': return 'inbox';
    case '\\Sent': return 'send';
    case '\\Drafts': return 'file-text';
    case '\\Trash': return 'trash-2';
    case '\\Junk': return 'alert-triangle';
    case '\\Archive': return 'archive';
    default: return 'folder';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ---------- skeletons & refresh indicator ---------- */

function skeletonListRows(n) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.className = 'skel-row';
    row.innerHTML = '<div class="skel-top"><span class="skel-bar w40"></span><span class="skel-bar w12"></span></div>' +
      '<span class="skel-bar w70"></span>';
    frag.append(row);
  }
  return frag;
}

function showListSkeleton() {
  const listEl = $('message-list');
  listEl.textContent = '';
  listEl.append(skeletonListRows(10));
}

function showReaderSkeleton() {
  $('reader').hidden = true;
  const empty = $('reader-empty');
  empty.hidden = false;
  empty.textContent = '';
  const card = document.createElement('div');
  card.className = 'skel-reader';
  card.innerHTML = '<span class="skel-bar w55 tall"></span><span class="skel-bar w35"></span>' +
    '<span class="skel-bar w45"></span><span class="skel-bar w25"></span><div class="skel-block"></div>';
  empty.append(card);
}

function setRefreshing(on) {
  const btn = $('btn-refresh');
  btn.classList.toggle('refreshing', Boolean(on));
}

/* ---------- sidebar ---------- */

async function refreshAccounts() {
  state.accounts = await mailApi.listAccounts();
  renderSidebar();
  $('btn-compose').disabled = state.accounts.length === 0;
  if (state.accounts.length === 0) {
    $('list-empty').hidden = false;
  }
}

function renderSidebar() {
  const nav = $('account-list');
  nav.textContent = '';
  for (const account of state.accounts) {
    const block = document.createElement('div');
    block.className = 'account-block';

    const head = document.createElement('div');
    head.className = 'account-name';
    const label = document.createElement('span');
    label.textContent = account.email;
    label.title = `${account.name} <${account.email}> (${account.protocol.toUpperCase()})`;
    const edit = document.createElement('button');
    edit.className = 'icon-btn small';
    edit.title = 'Signature & Email Design';
    edit.innerHTML = Icons.svg('edit-2', 11);
    edit.addEventListener('click', () => openTemplateDialog(account));
    const remove = document.createElement('button');
    remove.className = 'icon-btn small';
    remove.title = 'Remove account';
    remove.innerHTML = Icons.svg('x', 12);
    remove.addEventListener('click', () => removeAccount(account));
    head.append(label, edit, remove);
    block.append(head);

    const folders = state.mailboxes[account.id];
    if (!folders) {
      for (let i = 0; i < 3; i++) {
        const skel = document.createElement('div');
        skel.className = 'folder';
        skel.innerHTML = '<span class="skel-bar w55"></span>';
        block.append(skel);
      }
      loadMailboxes(account.id);
    } else {
      for (const box of folders) {
        const btn = document.createElement('button');
        btn.className = 'folder';
        const active = state.current &&
          state.current.accountId === account.id && state.current.mailbox === box.path;
        if (active) btn.classList.add('active');

        const icon = Icons.el(folderIcon(box.specialUse), 15);
        icon.classList.add('folder-icon');
        const name = document.createElement('span');
        name.className = 'folder-name';
        name.textContent = box.name;
        name.title = box.path;
        btn.append(icon, name);
        if (box.unseen) {
          const count = document.createElement('span');
          count.className = 'badge';
          count.textContent = box.unseen;
          btn.append(count);
        }
        btn.addEventListener('click', () => openMailbox(account.id, box.path, box.name));
        if (box.specialUse === '\\Trash' && account.protocol === 'imap') {
          btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            openTrashMenu(e, account, box);
          });
        }
        block.append(btn);
      }
    }
    nav.append(block);
  }
}

const mailboxLoads = new Set();

function autoOpenInbox(accountId) {
  if (state.current) return;
  const inbox = (state.mailboxes[accountId] || []).find((b) => b.specialUse === '\\Inbox');
  if (inbox) openMailbox(accountId, inbox.path, inbox.name);
}

async function loadMailboxes(accountId) {
  if (mailboxLoads.has(accountId)) return;
  mailboxLoads.add(accountId);
  try {
    // Last known folders render instantly while fresh ones load.
    const cached = await mailApi.cachedMailboxes(accountId).catch(() => null);
    if (cached && cached.length && !state.mailboxes[accountId]) {
      state.mailboxes[accountId] = cached;
      renderSidebar();
      autoOpenInbox(accountId);
    }
    try {
      state.mailboxes[accountId] = await mailApi.listMailboxes(accountId);
    } catch (err) {
      if (!state.mailboxes[accountId]) {
        state.mailboxes[accountId] = [];
        toast(err.message, true);
      }
    }
    renderSidebar();
    autoOpenInbox(accountId);
  } finally {
    mailboxLoads.delete(accountId);
  }
}

async function removeAccount(account) {
  const ok = await confirmDialog(
    'Remove Account',
    `Remove ${account.email} from LinuxMail? No mail is deleted from the server.`,
    'Remove'
  );
  if (!ok) return;
  await mailApi.removeAccount(account.id);
  delete state.mailboxes[account.id];
  if (state.current && state.current.accountId === account.id) {
    state.current = null;
    state.messages = [];
    renderMessageList();
    closeReader();
    $('mailbox-title').textContent = 'No mailbox';
    $('btn-refresh').disabled = true;
  }
  await refreshAccounts();
}

/* ---------- message list ---------- */

async function openMailbox(accountId, mailbox, displayName) {
  state.current = { accountId, mailbox };
  state.offset = 0;
  state.query = '';
  $('msg-search').value = '';
  $('msg-search').disabled = false;
  closeReader();
  $('mailbox-title').textContent = displayName || mailbox;
  $('btn-refresh').disabled = false;
  renderSidebar();
  await loadMessages();
}

async function loadMessages(append = false) {
  if (!state.current) return;
  const token = append ? state.loadToken : ++state.loadToken;
  const { accountId, mailbox } = state.current;

  if (!append) {
    state.offset = 0;
    let haveCache = false;
    if (!state.query) {
      // Render the last known list instantly, then refresh from the server.
      const cached = await mailApi.cachedList(accountId, mailbox).catch(() => null);
      if (token !== state.loadToken) return;
      if (cached && cached.messages.length) {
        state.total = cached.total;
        state.messages = cached.messages;
        renderMessageList();
        haveCache = true;
      }
    }
    if (!haveCache) showListSkeleton();
    setRefreshing(true);
  }
  state.loadingMore = true;

  try {
    const { total, messages } = await mailApi.listMessages(
      accountId, mailbox, state.offset, PAGE_SIZE, state.query
    );
    if (token !== state.loadToken) return;
    state.total = total;
    state.messages = append ? state.messages.concat(messages) : messages;
    renderMessageList();
    // Refresh sidebar unread counts in the background.
    mailApi.listMailboxes(state.current.accountId)
      .then((boxes) => { state.mailboxes[state.current.accountId] = boxes; renderSidebar(); })
      .catch(() => {});
  } catch (err) {
    if (token === state.loadToken) {
      if (state.messages.length) {
        toast(err.message, true); // keep showing the cached list
      } else {
        const listEl = $('message-list');
        listEl.textContent = '';
        const fail = document.createElement('div');
        fail.className = 'empty-state';
        fail.textContent = err.message;
        listEl.append(fail);
      }
    }
  } finally {
    state.loadingMore = false;
    if (token === state.loadToken) setRefreshing(false);
  }
}

function renderMessageList() {
  const listEl = $('message-list');
  listEl.textContent = '';

  if (!state.messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = state.query ? '<p>No messages match your search.</p>' : '<p>This folder is empty.</p>';
    listEl.append(empty);
  }

  for (const msg of state.messages) {
    const row = document.createElement('button');
    row.className = 'msg-row';
    if (msg.seen) row.classList.add('read');
    if (state.selected && state.selected.uid === msg.uid) row.classList.add('active');
    row.dataset.uid = msg.uid;

    const top = document.createElement('div');
    top.className = 'msg-top';
    const sender = document.createElement('span');
    sender.className = 'msg-sender';
    sender.textContent = msg.from ? (msg.from.name || msg.from.address || 'Unknown') : 'Unknown';
    const date = document.createElement('span');
    date.className = 'msg-date';
    date.textContent = formatDate(msg.date);
    top.append(sender, date);

    const sub = document.createElement('div');
    sub.className = 'msg-subline';
    const badges = document.createElement('span');
    badges.className = 'msg-badges';
    badges.innerHTML = (msg.flagged ? Icons.svg('star', 11) : '') +
      (msg.hasAttachments ? Icons.svg('paperclip', 11) : '');
    const subj = document.createElement('span');
    subj.className = 'msg-subject-text';
    subj.textContent = msg.subject;
    sub.append(badges, subj);

    row.append(top, sub);
    row.addEventListener('click', () => openMessage(msg));
    listEl.append(row);
  }

  $('page-info').textContent = state.total
    ? `${state.messages.length} of ${state.total}${state.query ? ' matching' : ''}`
    : '';
}

/* ---------- reader ---------- */

function setReaderButtons(enabled) {
  for (const id of ['btn-reply', 'btn-forward', 'btn-flag', 'btn-delete']) {
    $(id).disabled = !enabled;
  }
}

function closeReader() {
  state.selected = null;
  $('reader').hidden = true;
  $('reader-empty').hidden = false;
  $('reader-empty').textContent = 'Select a message to read it.';
  setReaderButtons(false);
}

async function openMessage(msgSummary) {
  state.selected = { uid: msgSummary.uid, flagged: msgSummary.flagged };
  const token = ++state.openToken;
  const { accountId, mailbox } = state.current;
  renderMessageList();

  // A cached body is immutable: render it and skip the network entirely,
  // just telling the server to mark the message read.
  let cached = await mailApi.cachedBody(accountId, mailbox, msgSummary.uid).catch(() => null);
  if (token !== state.openToken) return;
  if (cached && cached.fromAddr === undefined) cached = null; // pre-1.4.0 cache format
  if (cached) {
    if (!msgSummary.seen) {
      msgSummary.seen = true;
      mailApi.setFlag(accountId, mailbox, msgSummary.uid, 'seen', true).catch(() => {});
    }
    showMessage(cached, msgSummary);
    return;
  }

  showReaderSkeleton();
  try {
    const msg = await mailApi.fetchMessage(accountId, mailbox, msgSummary.uid);
    if (token !== state.openToken) return;
    msgSummary.seen = true;
    showMessage(msg, msgSummary);
  } catch (err) {
    if (token !== state.openToken) return;
    $('reader-empty').textContent = err.message;
  }
}

// Parses raw header text like "'Kirby Vail'" <kvail@noon.com>, x@y.z
// so names become clickable even for messages cached before structured
// addresses existed (or any path that only has the text form).
function parseAddressText(text) {
  const parts = [];
  let cur = '';
  let inQuote = false;
  let inAngle = false;
  for (const ch of String(text || '')) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === '<' && !inQuote) inAngle = true;
    else if (ch === '>' && !inQuote) inAngle = false;
    if (ch === ',' && !inQuote && !inAngle) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((part) => {
    const m = /^(.*)<([^>]+)>\s*$/.exec(part.trim());
    if (m) {
      return {
        name: m[1].replace(/^['"\s]+|['"\s]+$/g, '').replace(/['"]+/g, ''),
        address: m[2].trim()
      };
    }
    const addr = part.trim();
    return addr && addr.includes('@') ? { name: '', address: addr } : null;
  }).filter(Boolean);
}

function renderAddrList(el, addrs, fallbackText) {
  el.textContent = '';
  if (!addrs || !addrs.length) addrs = parseAddressText(fallbackText);
  if (addrs && addrs.length) {
    addrs.forEach((a) => {
      const chip = document.createElement('a');
      chip.className = 'addr-chip';
      chip.href = '#';
      chip.textContent = a.name || a.address;
      chip.title = a.address;
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openAddrPopover(chip, a);
      });
      el.append(chip);
    });
  } else {
    el.textContent = fallbackText || '';
  }
}

function showMessage(msg, msgSummary) {
  state.selected.msg = msg;

  $('reader-head').classList.add('collapsed');
  $('head-toggle').title = 'Show details';

  $('msg-subject').textContent = msg.subject;
  renderAddrList($('msg-from'), msg.fromAddr, msg.from);
  renderAddrList($('msg-to'), msg.toAddr, msg.to);
  $('msg-cc-row').hidden = !(msg.cc || (msg.ccAddr && msg.ccAddr.length));
  renderAddrList($('msg-cc'), msg.ccAddr, msg.cc);
  $('msg-date').textContent = msg.date ? new Date(msg.date).toLocaleString() : '';
  $('btn-flag').textContent = state.selected.flagged ? 'Unflag' : 'Flag';

  const attBar = $('attachment-bar');
  attBar.textContent = '';
  attBar.hidden = msg.attachments.length === 0;
  for (const att of msg.attachments) {
    const chip = document.createElement('button');
    chip.className = 'attachment-chip';
    chip.type = 'button';
    chip.innerHTML = Icons.svg('paperclip', 12) +
      ' <span>' + escapeHtml(att.filename) + (att.size ? ' (' + formatSize(att.size) + ')' : '') + '</span>';
    chip.addEventListener('click', async () => {
      try {
        const res = await mailApi.saveAttachment(
          state.current.accountId, state.current.mailbox, msgSummary.uid, att.index
        );
        if (res.saved) toast('Saved to ' + res.path);
      } catch (err) {
        toast(err.message, true);
      }
    });
    attBar.append(chip);
  }

  renderBody(msg);
  $('reader-empty').hidden = true;
  $('reader').hidden = false;
  setReaderButtons(true);
  renderMessageList();
}

function renderBody(msg) {
  const frame = $('msg-frame');
  let html;
  if (msg.html) {
    html = msg.html;
  } else {
    html = `<pre style="white-space:pre-wrap;font-family:system-ui,sans-serif;margin:0">${escapeHtml(msg.text)}</pre>`;
  }
  // sandbox="" on the iframe blocks all scripts/forms/popups; the page CSP
  // (inherited by the srcdoc document) additionally blocks remote images.
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8">
    <style>body{margin:14px;font-family:system-ui,sans-serif;color:#111;word-break:break-word}</style>
    </head><body>${html}</body></html>`;
}

/* ---------- reader actions ---------- */

$('btn-delete').addEventListener('click', async () => {
  if (!state.selected || !state.current) return;
  const uid = state.selected.uid;
  try {
    await mailApi.deleteMessage(state.current.accountId, state.current.mailbox, uid);
    toast('Message deleted');
    closeReader();
    await loadMessages();
  } catch (err) {
    toast(err.message, true);
  }
});

$('btn-flag').addEventListener('click', async () => {
  if (!state.selected || !state.current) return;
  const next = !state.selected.flagged;
  try {
    await mailApi.setFlag(state.current.accountId, state.current.mailbox, state.selected.uid, 'flagged', next);
    state.selected.flagged = next;
    const row = state.messages.find((m) => m.uid === state.selected.uid);
    if (row) row.flagged = next;
    $('btn-flag').textContent = next ? 'Unflag' : 'Flag';
    renderMessageList();
  } catch (err) {
    toast(err.message, true);
  }
});

function quoteBody(msg) {
  const src = msg.text || '';
  const header = `On ${msg.date ? new Date(msg.date).toLocaleString() : ''}, ${msg.from} wrote:`;
  return '\n\n' + header + '\n' + src.split('\n').map((l) => '> ' + l).join('\n');
}

function extractAddress(fromText) {
  const m = /<([^>]+)>/.exec(fromText || '');
  return m ? m[1] : (fromText || '').trim();
}

$('btn-reply').addEventListener('click', () => {
  if (!state.selected || !state.selected.msg) return;
  const msg = state.selected.msg;
  openCompose({
    accountId: state.current.accountId,
    to: extractAddress(msg.from),
    subject: msg.subject.startsWith('Re:') ? msg.subject : 'Re: ' + msg.subject,
    body: quoteBody(msg),
    inReplyTo: msg.messageId,
    references: [msg.references, msg.messageId].flat().filter(Boolean).join(' '),
    title: 'Reply'
  });
});

$('btn-forward').addEventListener('click', () => {
  if (!state.selected || !state.selected.msg) return;
  const msg = state.selected.msg;
  openCompose({
    accountId: state.current.accountId,
    to: '',
    subject: msg.subject.startsWith('Fwd:') ? msg.subject : 'Fwd: ' + msg.subject,
    body: '\n\n---------- Forwarded message ----------\n' +
      `From: ${msg.from}\nDate: ${msg.date ? new Date(msg.date).toLocaleString() : ''}\n` +
      `Subject: ${msg.subject}\nTo: ${msg.to}\n\n${msg.text || ''}`,
    title: 'Forward'
  });
});

/* ---------- toolbar ---------- */

$('btn-refresh').addEventListener('click', () => loadMessages());

$('message-list').addEventListener('scroll', () => {
  const el = $('message-list');
  if (state.loadingMore || !state.current) return;
  if (state.messages.length >= state.total) return;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
    state.offset = state.messages.length;
    loadMessages(true);
  }
});

$('msg-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    state.query = e.target.value.trim();
    loadMessages();
  }
});
$('msg-search').addEventListener('input', (e) => {
  if (!e.target.value.trim() && state.query) {
    state.query = '';
    loadMessages();
  }
});

/* ---------- add-account dialog ---------- */

const dlgAccount = $('dlg-account');

$('btn-add-account').addEventListener('click', () => {
  $('form-account').reset();
  $('acc-error').hidden = true;
  $('provider-hint').textContent =
    'Enter your address — server settings are detected automatically for common providers.';
  dlgAccount.showModal();
});

$('acc-cancel').addEventListener('click', () => dlgAccount.close());

let detectTimer = null;
$('acc-email').addEventListener('input', () => {
  clearTimeout(detectTimer);
  detectTimer = setTimeout(applyDetection, 400);
});
$('acc-protocol').addEventListener('change', applyDetection);

async function applyDetection() {
  const email = $('acc-email').value.trim();
  if (!email.includes('@') || email.endsWith('@')) return;
  try {
    const preset = await mailApi.detectProvider(email);
    if (!preset) return;
    const protocol = $('acc-protocol').value;
    const incoming = protocol === 'pop3' ? preset.pop3 : preset.imap;
    if (incoming) {
      $('acc-in-host').value = incoming.host;
      $('acc-in-port').value = incoming.port;
      $('acc-in-sec').value = incoming.security;
    } else if (protocol === 'pop3') {
      $('provider-hint').textContent = `${preset.label} does not offer POP3 — use IMAP instead.`;
      return;
    }
    $('acc-smtp-host').value = preset.smtp.host;
    $('acc-smtp-port').value = preset.smtp.port;
    $('acc-smtp-sec').value = preset.smtp.security;
    $('provider-hint').textContent = preset.label
      ? `${preset.label} detected. ${preset.note}`
      : preset.note;
  } catch (_) { /* detection is best-effort */ }
}

$('form-account').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errEl = $('acc-error');
  errEl.hidden = true;

  const email = $('acc-email').value.trim();
  const password = $('acc-password').value;
  if (!email.includes('@') || !password) {
    errEl.textContent = 'Email address and password are required.';
    errEl.hidden = false;
    return;
  }
  if (!$('acc-in-host').value) await applyDetection();

  const input = {
    name: $('acc-name').value.trim() || email,
    email,
    password,
    loginUser: $('acc-login').value.trim() || email,
    protocol: $('acc-protocol').value,
    incoming: {
      host: $('acc-in-host').value.trim(),
      port: Number($('acc-in-port').value),
      security: $('acc-in-sec').value
    },
    smtp: {
      host: $('acc-smtp-host').value.trim(),
      port: Number($('acc-smtp-port').value),
      security: $('acc-smtp-sec').value
    }
  };
  if (!input.incoming.host || !input.smtp.host) {
    errEl.textContent = 'Could not detect server settings — open “Server settings” and fill them in.';
    errEl.hidden = false;
    $('acc-advanced').open = true;
    return;
  }

  const submit = $('acc-submit');
  submit.disabled = true;
  submit.textContent = 'Checking…';
  try {
    const account = await mailApi.addAccount(input);
    dlgAccount.close();
    toast(`Signed in as ${account.email}`);
    await refreshAccounts();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
    $('acc-advanced').open = true;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Sign in';
  }
});

/* ---------- compose dialog ---------- */

const dlgCompose = $('dlg-compose');

function openCompose(opts = {}) {
  if (!state.accounts.length) return;
  $('form-compose').reset();
  state.attachments = [];
  renderAttachList();
  $('cmp-error').hidden = true;
  $('compose-title').textContent = opts.title || 'New message';

  const fromSel = $('cmp-from');
  fromSel.textContent = '';
  for (const account of state.accounts) {
    const opt = document.createElement('option');
    opt.value = account.id;
    opt.textContent = `${account.name} <${account.email}>`;
    fromSel.append(opt);
  }
  fromSel.value = opts.accountId || (state.current && state.current.accountId) || state.accounts[0].id;
  window.Dropdown.sync(fromSel);

  $('cmp-to').value = opts.to || '';
  $('cmp-subject').value = opts.subject || '';
  const fromAccount = state.accounts.find((a) => a.id === fromSel.value);
  const sig = fromAccount && fromAccount.signatureText;
  $('cmp-body').value = (sig ? '\n\n-- \n' + sig : '') + (opts.body || '');
  state.composeContext = {
    inReplyTo: opts.inReplyTo || null,
    references: opts.references || null
  };
  dlgCompose.showModal();
  const focusTarget = opts.to ? $('cmp-body') : $('cmp-to');
  focusTarget.focus();
  if (focusTarget === $('cmp-body')) focusTarget.setSelectionRange(0, 0);
}

function renderAttachList() {
  $('cmp-attach-list').textContent = state.attachments.length
    ? state.attachments.map((a) => `${a.filename} (${formatSize(a.size)})`).join(', ')
    : '';
}

$('btn-compose').addEventListener('click', () => openCompose());
$('cmp-cancel').addEventListener('click', () => dlgCompose.close());

$('cmp-attach').addEventListener('click', async () => {
  try {
    const files = await mailApi.pickAttachments();
    state.attachments.push(...files);
    renderAttachList();
  } catch (err) {
    toast(err.message, true);
  }
});

$('form-compose').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errEl = $('cmp-error');
  errEl.hidden = true;
  const to = $('cmp-to').value.trim();
  if (!to) {
    errEl.textContent = 'Add at least one recipient.';
    errEl.hidden = false;
    return;
  }
  const btn = $('cmp-send');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    await mailApi.sendMessage($('cmp-from').value, {
      to,
      cc: $('cmp-cc').value.trim(),
      bcc: $('cmp-bcc').value.trim(),
      subject: $('cmp-subject').value,
      text: $('cmp-body').value,
      inReplyTo: state.composeContext ? state.composeContext.inReplyTo : null,
      references: state.composeContext ? state.composeContext.references : null,
      attachments: state.attachments
    });
    dlgCompose.close();
    toast('Message sent');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send';
  }
});

/* ---------- confirm dialog ---------- */

function confirmDialog(title, text, okLabel) {
  return new Promise((resolve) => {
    const dlg = $('dlg-confirm');
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    const okBtn = $('confirm-ok');
    okBtn.textContent = okLabel || 'OK';
    okBtn.classList.toggle('btn-danger', /remove|delete/i.test(okLabel || ''));
    okBtn.classList.toggle('btn-primary', !/remove|delete/i.test(okLabel || ''));

    const done = (result) => {
      dlg.close();
      okBtn.removeEventListener('click', onOk);
      $('confirm-cancel').removeEventListener('click', onCancel);
      dlg.removeEventListener('cancel', onCancel);
      resolve(result);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    okBtn.addEventListener('click', onOk);
    $('confirm-cancel').addEventListener('click', onCancel);
    dlg.addEventListener('cancel', onCancel);
    dlg.showModal();
  });
}

/* ---------- show password ---------- */

$('acc-show-pass').addEventListener('change', (e) => {
  $('acc-password').type = e.target.checked ? 'text' : 'password';
});

/* ---------- titlebar: window controls & menus ---------- */

$('win-min').addEventListener('click', () => mailApi.windowControl('minimize'));
$('win-close').addEventListener('click', () => mailApi.windowControl('close'));
$('win-max').addEventListener('click', () => mailApi.windowControl('maximize'));
document.querySelector('.tb-drag').addEventListener('dblclick', () => mailApi.windowControl('maximize'));
mailApi.onWindowMaximized((maximized) => {
  $('win-max').innerHTML = Icons.svg(maximized ? 'copy' : 'square', 12);
  $('win-max').title = maximized ? 'Restore' : 'Maximize';
});

const MENUS = {
  file: [
    { label: 'New Message', action: () => openCompose() },
    { label: 'Add Account', action: () => $('btn-add-account').click() },
    { sep: true },
    { label: 'Quit', action: () => mailApi.appAction('quit') }
  ],
  edit: [
    { label: 'Undo', action: () => mailApi.appAction('undo') },
    { label: 'Redo', action: () => mailApi.appAction('redo') },
    { sep: true },
    { label: 'Cut', action: () => mailApi.appAction('cut') },
    { label: 'Copy', action: () => mailApi.appAction('copy') },
    { label: 'Paste', action: () => mailApi.appAction('paste') },
    { label: 'Select All', action: () => mailApi.appAction('select-all') }
  ],
  view: [
    { label: 'Reload', action: () => mailApi.appAction('reload') },
    { label: 'Toggle Developer Tools', action: () => mailApi.appAction('devtools') },
    { sep: true },
    { label: 'Zoom In', action: () => mailApi.appAction('zoom-in') },
    { label: 'Zoom Out', action: () => mailApi.appAction('zoom-out') },
    { label: 'Actual Size', action: () => mailApi.appAction('zoom-reset') },
    { sep: true },
    { label: 'Toggle Full Screen', action: () => mailApi.appAction('fullscreen') }
  ],
  help: [
    { label: 'LinuxMail on GitHub', action: () => mailApi.appAction('github') }
  ]
};

let openMenuBtn = null;

function closeMenu() {
  $('menu-pop').hidden = true;
  if (openMenuBtn) openMenuBtn.classList.remove('active');
  openMenuBtn = null;
}

function openMenu(btn) {
  const pop = $('menu-pop');
  pop.textContent = '';
  for (const item of MENUS[btn.dataset.menu]) {
    if (item.sep) {
      const sep = document.createElement('div');
      sep.className = 'menu-sep';
      pop.append(sep);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'dd-option';
    row.textContent = item.label;
    row.addEventListener('click', () => { closeMenu(); item.action(); });
    pop.append(row);
  }
  const rect = btn.getBoundingClientRect();
  pop.style.left = rect.left + 'px';
  pop.style.top = rect.bottom + 4 + 'px';
  pop.hidden = false;
  if (openMenuBtn) openMenuBtn.classList.remove('active');
  openMenuBtn = btn;
  btn.classList.add('active');
}

document.querySelectorAll('.menu-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openMenuBtn === btn) closeMenu();
    else openMenu(btn);
  });
  btn.addEventListener('mouseenter', () => {
    if (openMenuBtn && openMenuBtn !== btn) openMenu(btn);
  });
});
document.addEventListener('pointerdown', (e) => {
  if (openMenuBtn && !$('menu-pop').contains(e.target) && e.target !== openMenuBtn) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openMenuBtn) closeMenu();
});

/* ---------- signature & template dialog ---------- */

const dlgTemplate = $('dlg-template');
let templateAccountId = null;

const TPL_FONT_STACKS = {
  sans: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'SF Mono', Menlo, Consolas, monospace"
};

let tplLogo = '';

function currentTemplateInput() {
  return {
    signature: $('tpl-signature').value,
    sigName: $('tpl-name').value.trim(),
    sigTitle: $('tpl-title').value.trim(),
    sigCompany: $('tpl-company').value.trim(),
    sigPhone: $('tpl-phone').value.trim(),
    sigLogo: tplLogo,
    styled: $('tpl-styled').checked,
    bg: $('tpl-bg').value,
    card: $('tpl-card').value,
    text: $('tpl-text').value,
    accent: $('tpl-accent').value,
    font: $('tpl-font').value
  };
}

function templatePreview() {
  const t = currentTemplateInput();
  const styled = t.styled;
  const box = $('tpl-preview');
  const card = $('tpl-preview-card');
  const sigEl = $('tpl-preview-sig');
  box.style.background = styled ? t.bg : 'var(--bg)';
  card.style.background = styled ? t.card : 'var(--bg-elevated)';
  card.style.color = styled ? t.text : 'var(--text)';
  card.style.fontFamily = TPL_FONT_STACKS[t.font] || TPL_FONT_STACKS.sans;
  $('tpl-preview-body').textContent = 'Hi there,\n\nThis is how your emails will look.';

  sigEl.textContent = '';
  const hasSig = t.sigName || t.signature.trim();
  sigEl.hidden = !hasSig;
  sigEl.style.borderTopColor = styled ? t.accent : 'var(--border)';
  if (t.sigName) {
    if (t.signature.trim()) {
      const closing = document.createElement('div');
      closing.className = 'sig-closing';
      closing.textContent = t.signature.trim();
      sigEl.append(closing);
    }
    const row = document.createElement('div');
    row.className = 'sig-row';
    if (tplLogo && styled) {
      const img = document.createElement('img');
      img.src = tplLogo;
      img.className = 'sig-logo';
      row.append(img);
    }
    const details = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'sig-name';
    name.textContent = t.sigName;
    details.append(name);
    const role = [t.sigTitle, t.sigCompany].filter(Boolean).join(', ');
    if (role) {
      const r = document.createElement('div');
      r.className = 'sig-role';
      r.textContent = role;
      details.append(r);
    }
    if (t.sigPhone) {
      const ph = document.createElement('div');
      ph.className = 'sig-role';
      ph.textContent = t.sigPhone;
      details.append(ph);
    }
    row.append(details);
    sigEl.append(row);
  } else if (t.signature.trim()) {
    sigEl.textContent = t.signature.trim();
  }
  $('tpl-colors').style.opacity = styled ? 1 : 0.45;
}

function setTplLogo(dataUrl) {
  tplLogo = dataUrl || '';
  $('tpl-logo-img').src = tplLogo;
  $('tpl-logo-img').hidden = !tplLogo;
  $('tpl-logo-clear').hidden = !tplLogo;
  templatePreview();
}

$('tpl-logo-pick').addEventListener('click', async () => {
  try {
    const dataUrl = await mailApi.pickLogo();
    if (dataUrl) setTplLogo(dataUrl);
  } catch (err) {
    toast(err.message, true);
  }
});
$('tpl-logo-clear').addEventListener('click', () => setTplLogo(''));

function openTemplateDialog(account) {
  templateAccountId = account.id;
  const t = account.template || {};
  $('tpl-account-label').textContent = 'For ' + account.email;
  $('tpl-signature').value = t.signature || '';
  $('tpl-name').value = t.sigName || '';
  $('tpl-title').value = t.sigTitle || '';
  $('tpl-company').value = t.sigCompany || '';
  $('tpl-phone').value = t.sigPhone || '';
  setTplLogo(t.sigLogo || '');
  $('tpl-styled').checked = Boolean(t.styled);
  $('tpl-bg').value = t.bg || '#f5f5f7';
  $('tpl-card').value = t.card || '#ffffff';
  $('tpl-text').value = t.text || '#1d1d1f';
  $('tpl-accent').value = t.accent || '#007AFF';
  $('tpl-font').value = t.font || 'sans';
  window.Dropdown.sync($('tpl-font'));
  templatePreview();
  dlgTemplate.showModal();
}

for (const id of ['tpl-signature', 'tpl-name', 'tpl-title', 'tpl-company', 'tpl-phone', 'tpl-styled', 'tpl-bg', 'tpl-card', 'tpl-text', 'tpl-accent', 'tpl-font']) {
  $(id).addEventListener('input', templatePreview);
  $(id).addEventListener('change', templatePreview);
}

$('tpl-cancel').addEventListener('click', () => dlgTemplate.close());

$('form-template').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await mailApi.updateAccount(templateAccountId, { template: currentTemplateInput() });
    dlgTemplate.close();
    toast('Template saved');
    await refreshAccounts();
  } catch (err) {
    toast(err.message, true);
  }
});

/* ---------- trash context menu ---------- */

function openTrashMenu(event, account, box) {
  const pop = $('addr-pop'); // reused generic popover panel
  pop.textContent = '';
  const row = document.createElement('div');
  row.className = 'dd-option';
  row.textContent = 'Delete All Items';
  row.addEventListener('click', async () => {
    pop.hidden = true;
    const ok = await confirmDialog(
      'Empty ' + box.name,
      'Are you sure you want to clear all your Deleted Items? This is permanent.',
      'Delete All'
    );
    if (!ok) return;
    try {
      await mailApi.emptyMailbox(account.id, box.path);
      toast(box.name + ' emptied');
      if (state.current && state.current.accountId === account.id && state.current.mailbox === box.path) {
        closeReader();
        await loadMessages();
      }
      mailApi.listMailboxes(account.id)
        .then((boxes) => { state.mailboxes[account.id] = boxes; renderSidebar(); })
        .catch(() => {});
    } catch (err) {
      toast(err.message, true);
    }
  });
  pop.append(row);
  pop.hidden = false;
  const popRect = pop.getBoundingClientRect();
  pop.style.left = Math.min(event.clientX, window.innerWidth - popRect.width - 8) + 'px';
  pop.style.top = Math.min(event.clientY, window.innerHeight - popRect.height - 8) + 'px';
}

/* ---------- collapsible reader head ---------- */

$('head-toggle').addEventListener('click', () => {
  const head = $('reader-head');
  const collapsed = head.classList.toggle('collapsed');
  $('head-toggle').title = collapsed ? 'Show details' : 'Hide details';
});

/* ---------- address popover (email / add to contacts) ---------- */

async function openAddrPopover(anchor, addr) {
  const pop = $('addr-pop');
  pop.textContent = '';

  const header = document.createElement('div');
  header.className = 'addr-pop-head';
  header.textContent = addr.address;
  pop.append(header);

  const emailRow = document.createElement('div');
  emailRow.className = 'dd-option';
  emailRow.textContent = 'Send Email';
  emailRow.addEventListener('click', () => {
    pop.hidden = true;
    openCompose({ to: addr.address, title: 'New Message' });
  });
  pop.append(emailRow);

  const known = await mailApi.hasContact(addr.address).catch(() => false);
  const addRow = document.createElement('div');
  addRow.className = 'dd-option';
  if (known) {
    addRow.textContent = 'In Contacts';
    addRow.classList.add('disabled');
  } else {
    addRow.textContent = 'Add to Contacts';
    addRow.addEventListener('click', async () => {
      pop.hidden = true;
      try {
        await mailApi.addContact(addr.name || '', addr.address);
        toast('Added ' + (addr.name || addr.address) + ' to contacts');
      } catch (err) {
        toast(err.message, true);
      }
    });
  }
  pop.append(addRow);

  const rect = anchor.getBoundingClientRect();
  pop.hidden = false;
  const popRect = pop.getBoundingClientRect();
  pop.style.left = Math.min(rect.left, window.innerWidth - popRect.width - 8) + 'px';
  pop.style.top = Math.min(rect.bottom + 4, window.innerHeight - popRect.height - 8) + 'px';
}

document.addEventListener('pointerdown', (e) => {
  const pop = $('addr-pop');
  if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true;
});

/* ---------- recipient autocomplete ---------- */

const suggestState = { input: null, items: [], index: -1 };

function hideSuggest() {
  $('suggest-pop').hidden = true;
  suggestState.input = null;
  suggestState.items = [];
  suggestState.index = -1;
}

function applySuggestion(item) {
  const input = suggestState.input;
  if (!input) return;
  const parts = input.value.split(',');
  parts[parts.length - 1] = ' ' + (item.name ? `${item.name} <${item.address}>` : item.address);
  input.value = parts.join(',').replace(/^ /, '') + ', ';
  hideSuggest();
  input.focus();
}

function renderSuggest() {
  const pop = $('suggest-pop');
  pop.textContent = '';
  suggestState.items.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'dd-option' + (i === suggestState.index ? ' focused' : '');
    const label = document.createElement('span');
    label.className = 'sug-label';
    label.innerHTML = (item.isContact ? Icons.svg('users', 11) + ' ' : '') +
      (item.name ? escapeHtml(item.name) + ' <span class="sug-addr">' + escapeHtml(item.address) + '</span>'
                 : escapeHtml(item.address));
    row.append(label);
    row.addEventListener('mousedown', (e) => { e.preventDefault(); applySuggestion(item); });
    pop.append(row);
  });
  pop.hidden = suggestState.items.length === 0;
  if (!pop.hidden && suggestState.input) {
    const rect = suggestState.input.getBoundingClientRect();
    pop.style.left = rect.left + 'px';
    pop.style.top = rect.bottom + 4 + 'px';
    pop.style.width = rect.width + 'px';
  }
}

let suggestTimer = null;

function attachAutocomplete(input) {
  input.addEventListener('input', () => {
    const lastPart = input.value.split(',').pop().trim();
    clearTimeout(suggestTimer);
    if (!lastPart) { hideSuggest(); return; }
    suggestTimer = setTimeout(async () => {
      try {
        const items = await mailApi.suggestRecipients(lastPart);
        suggestState.input = input;
        suggestState.items = items.filter((it) => !input.value.toLowerCase().includes(it.address));
        suggestState.index = suggestState.items.length ? 0 : -1;
        renderSuggest();
      } catch (_) { hideSuggest(); }
    }, 150);
  });
  input.addEventListener('keydown', (e) => {
    if ($('suggest-pop').hidden || suggestState.input !== input) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestState.index = Math.min(suggestState.items.length - 1, suggestState.index + 1);
      renderSuggest();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestState.index = Math.max(0, suggestState.index - 1);
      renderSuggest();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (suggestState.index >= 0) {
        e.preventDefault();
        applySuggestion(suggestState.items[suggestState.index]);
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      hideSuggest();
    }
  });
  input.addEventListener('blur', () => setTimeout(hideSuggest, 150));
}

['cmp-to', 'cmp-cc', 'cmp-bcc'].forEach((id) => attachAutocomplete($(id)));

/* ---------- contacts dialog ---------- */

const dlgContacts = $('dlg-contacts');
let contactsCache = [];

function renderContacts() {
  const listEl = $('contact-list');
  const q = $('ct-search').value.trim().toLowerCase();
  listEl.textContent = '';
  const visible = contactsCache.filter((c) =>
    !q || c.address.includes(q) || (c.name && c.name.toLowerCase().includes(q)));
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = contactsCache.length ? 'No contacts match your search.' : 'No contacts yet — add one above, or use “Add to Contacts” on any sender.';
    listEl.append(empty);
    return;
  }
  for (const c of visible) {
    const row = document.createElement('div');
    row.className = 'contact-row';
    const info = document.createElement('div');
    info.className = 'contact-info';
    const name = document.createElement('div');
    name.className = 'contact-name';
    name.textContent = c.name || c.address;
    info.append(name);
    if (c.name) {
      const mail = document.createElement('div');
      mail.className = 'contact-mail';
      mail.textContent = c.address;
      info.append(mail);
    }
    const compose = document.createElement('button');
    compose.type = 'button';
    compose.className = 'icon-btn';
    compose.title = 'Send Email';
    compose.innerHTML = Icons.svg('send', 13);
    compose.addEventListener('click', () => {
      dlgContacts.close();
      openCompose({ to: c.address });
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-btn';
    remove.title = 'Remove';
    remove.innerHTML = Icons.svg('x', 13);
    remove.addEventListener('click', async () => {
      contactsCache = await mailApi.removeContact(c.address);
      renderContacts();
    });
    row.append(info, compose, remove);
    listEl.append(row);
  }
}

$('btn-contacts').addEventListener('click', async () => {
  contactsCache = await mailApi.listContacts().catch(() => []);
  $('ct-search').value = '';
  $('ct-name').value = '';
  $('ct-email').value = '';
  renderContacts();
  dlgContacts.showModal();
});
$('ct-close').addEventListener('click', () => dlgContacts.close());
$('ct-search').addEventListener('input', renderContacts);
$('ct-add').addEventListener('click', async () => {
  try {
    contactsCache = await mailApi.addContact($('ct-name').value, $('ct-email').value);
    $('ct-name').value = '';
    $('ct-email').value = '';
    renderContacts();
  } catch (err) {
    toast(err.message, true);
  }
});

/* ---------- boot ---------- */

refreshAccounts().then(() => {
  if (!state.accounts.length) {
    $('btn-add-account').click();
  }
});
