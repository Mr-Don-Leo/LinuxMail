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
    case '\\Inbox': return '📥';
    case '\\Sent': return '📤';
    case '\\Drafts': return '📝';
    case '\\Trash': return '🗑';
    case '\\Junk': return '⚠';
    case '\\Archive': return '📦';
    default: return '📁';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
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
    const remove = document.createElement('button');
    remove.className = 'icon-btn small';
    remove.title = 'Remove account';
    remove.textContent = '×';
    remove.addEventListener('click', () => removeAccount(account));
    head.append(label, remove);
    block.append(head);

    const folders = state.mailboxes[account.id];
    if (!folders) {
      const loading = document.createElement('div');
      loading.className = 'folder';
      loading.textContent = 'Loading folders…';
      block.append(loading);
      loadMailboxes(account.id);
    } else {
      for (const box of folders) {
        const btn = document.createElement('button');
        btn.className = 'folder';
        const active = state.current &&
          state.current.accountId === account.id && state.current.mailbox === box.path;
        if (active) btn.classList.add('active');

        const icon = document.createElement('span');
        icon.textContent = folderIcon(box.specialUse);
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
        block.append(btn);
      }
    }
    nav.append(block);
  }
}

async function loadMailboxes(accountId) {
  try {
    state.mailboxes[accountId] = await mailApi.listMailboxes(accountId);
  } catch (err) {
    state.mailboxes[accountId] = [];
    toast(err.message, true);
  }
  renderSidebar();
  // Auto-open the first inbox if nothing is open yet.
  if (!state.current) {
    const inbox = (state.mailboxes[accountId] || []).find((b) => b.specialUse === '\\Inbox');
    if (inbox) openMailbox(accountId, inbox.path, inbox.name);
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
  const listEl = $('message-list');
  if (!append) {
    state.offset = 0;
    listEl.textContent = '';
    const loading = document.createElement('div');
    loading.className = 'empty-state';
    loading.innerHTML = '<p><span class="spin">⟳</span> Loading messages…</p>';
    listEl.append(loading);
  }
  state.loadingMore = true;

  try {
    const { total, messages } = await mailApi.listMessages(
      state.current.accountId, state.current.mailbox, state.offset, PAGE_SIZE, state.query
    );
    state.total = total;
    state.messages = append ? state.messages.concat(messages) : messages;
    renderMessageList();
    // Refresh sidebar unread counts in the background.
    mailApi.listMailboxes(state.current.accountId)
      .then((boxes) => { state.mailboxes[state.current.accountId] = boxes; renderSidebar(); })
      .catch(() => {});
  } catch (err) {
    listEl.textContent = '';
    const fail = document.createElement('div');
    fail.className = 'empty-state';
    fail.textContent = err.message;
    listEl.append(fail);
  } finally {
    state.loadingMore = false;
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
    badges.textContent = (msg.flagged ? '★' : '') + (msg.hasAttachments ? '📎' : '');
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
  renderMessageList();
  $('reader-empty').hidden = false;
  $('reader-empty').textContent = 'Loading message…';
  $('reader').hidden = true;

  try {
    const msg = await mailApi.fetchMessage(
      state.current.accountId, state.current.mailbox, msgSummary.uid
    );
    msgSummary.seen = true;
    state.selected.msg = msg;

    $('msg-subject').textContent = msg.subject;
    $('msg-from').textContent = msg.from;
    $('msg-to').textContent = msg.to;
    $('msg-cc-row').hidden = !msg.cc;
    $('msg-cc').textContent = msg.cc;
    $('msg-date').textContent = msg.date ? new Date(msg.date).toLocaleString() : '';
    $('btn-flag').textContent = state.selected.flagged ? 'Unflag' : 'Flag';

    const attBar = $('attachment-bar');
    attBar.textContent = '';
    attBar.hidden = msg.attachments.length === 0;
    for (const att of msg.attachments) {
      const chip = document.createElement('button');
      chip.className = 'attachment-chip';
      chip.type = 'button';
      chip.textContent = `📎 ${att.filename}${att.size ? ' (' + formatSize(att.size) + ')' : ''}`;
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
  } catch (err) {
    $('reader-empty').textContent = err.message;
  }
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
  $('cmp-body').value = opts.body || '';
  state.composeContext = {
    inReplyTo: opts.inReplyTo || null,
    references: opts.references || null
  };
  dlgCompose.showModal();
  (opts.to ? $('cmp-body') : $('cmp-to')).focus();
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

/* ---------- boot ---------- */

refreshAccounts().then(() => {
  if (!state.accounts.length) {
    $('btn-add-account').click();
  }
});
