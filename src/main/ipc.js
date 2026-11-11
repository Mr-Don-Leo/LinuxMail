'use strict';

const { ipcMain, dialog, BrowserWindow, app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { detectProvider } = require('./providers');
const cache = require('./cache');
const contacts = require('./contacts');
const imap = require('./mail/imap');
const pop3 = require('./mail/pop3');
const smtp = require('./mail/smtp');

function backendFor(account) {
  return account.protocol === 'pop3' ? pop3 : imap;
}

// True when the server rejected the stored credentials (expired/changed
// password), as opposed to network or mailbox errors. imapflow reports a
// failed LOGIN as a bare "Command failed" with authenticationFailed set.
function isAuthError(err) {
  if (!err) return false;
  if (err.authenticationFailed || err.code === 'EAUTH' || err.code === 'ECREDS') return true;
  if (err.serverResponseCode === 'AUTHENTICATIONFAILED') return true;
  if (err.responseCode === 534 || err.responseCode === 535) return true;
  const text = [err.message, err.responseText, err.response].filter(Boolean).join(' ');
  return /authentication failed|invalid credentials|login failed|\[AUTH\]|-ERR .*(password|login|auth)/i.test(text);
}

function friendlyError(err) {
  const msg = (err && err.message) || String(err);
  if (isAuthError(err) || /auth|login|credential|password|535|invalid/i.test(msg)) {
    // imapflow's message is a generic "Command failed"; the server's reason
    // lives in responseText.
    const detail = (err && err.responseText) || (msg === 'Command failed' ? '' : msg);
    return 'Sign-in failed — check your email, password (many providers need an app password), and server settings.' +
      (detail ? ' (' + detail + ')' : '');
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return 'Server not found — check the host name and your internet connection.';
  if (/ETIMEDOUT|ECONNREFUSED|ECONNRESET/i.test(msg)) return 'Could not reach the server — check host, port and security settings.';
  return msg;
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, data: await fn(event, ...args) };
    } catch (err) {
      console.error(`[${channel}]`, err);
      const result = { ok: false, error: friendlyError(err) };
      // mail:* handlers take the account id first; tell the renderer which
      // account needs its password re-entered.
      if (channel.startsWith('mail:') && typeof args[0] === 'string' && isAuthError(err)) {
        result.reauth = args[0];
      }
      return result;
    }
  });
}

function registerIpcHandlers() {
  handle('window:control', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    switch (action) {
      case 'minimize': win.minimize(); break;
      case 'maximize': win.isMaximized() ? win.unmaximize() : win.maximize(); break;
      case 'close': win.close(); break;
      case 'isMaximized': return win.isMaximized();
    }
    return win.isMaximized();
  });

  handle('app:action', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const wc = win && win.webContents;
    switch (action) {
      case 'quit': app.quit(); break;
      case 'reload': if (wc) wc.reload(); break;
      case 'devtools': if (wc) wc.toggleDevTools(); break;
      case 'zoom-in': if (wc) wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 5)); break;
      case 'zoom-out': if (wc) wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -5)); break;
      case 'zoom-reset': if (wc) wc.setZoomLevel(0); break;
      case 'fullscreen': if (win) win.setFullScreen(!win.isFullScreen()); break;
      case 'undo': if (wc) wc.undo(); break;
      case 'redo': if (wc) wc.redo(); break;
      case 'cut': if (wc) wc.cut(); break;
      case 'copy': if (wc) wc.copy(); break;
      case 'paste': if (wc) wc.paste(); break;
      case 'select-all': if (wc) wc.selectAll(); break;
      case 'github': shell.openExternal('https://github.com/Mr-Don-Leo/LinuxMail'); break;
    }
  });

  // Opens with xdg-open, i.e. the user's preferred browser.
  handle('app:openExternal', async (_e, url) => {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only web links can be opened');
    }
    await shell.openExternal(parsed.href);
  });

  handle('accounts:list', () => store.listAccounts());
  handle('accounts:detect', (_e, email) => detectProvider(email));

  handle('accounts:add', async (_e, input) => {
    // Validate credentials against both servers before saving.
    const candidate = {
      id: 'candidate',
      name: input.name || input.email,
      email: input.email,
      protocol: input.protocol,
      incoming: input.incoming,
      smtp: input.smtp
    };
    const credentials = { user: input.loginUser || input.email, password: input.password };
    await backendFor(candidate).verify(candidate, credentials);
    await smtp.verify(candidate, credentials);
    return store.addAccount(input);
  });

  handle('accounts:update', (_e, id, input) => store.updateAccount(id, input));

  handle('accounts:reauth', async (_e, id, password) => {
    // Re-validate an existing account with a new password before saving it.
    const account = store.getAccount(id);
    const credentials = { user: account.loginUser || account.email, password: String(password || '') };
    if (!credentials.password) throw new Error('Enter your password.');
    await backendFor(account).verify(account, credentials);
    await smtp.verify(account, credentials);
    await imap.dropClient(id);
    return store.updateAccount(id, { password: credentials.password });
  });
  handle('accounts:remove', (_e, id) => {
    store.removeAccount(id);
    cache.clearAccount(id);
  });

  handle('mail:cachedMailboxes', (_e, accountId) => cache.getMailboxes(accountId));
  handle('mail:cachedList', (_e, accountId, mailbox) => cache.getList(accountId, mailbox));
  handle('mail:cachedBody', (_e, accountId, mailbox, uid) => cache.getBody(accountId, mailbox, uid));

  handle('mail:mailboxes', async (_e, accountId) => {
    const account = store.getAccount(accountId);
    const boxes = await backendFor(account).listMailboxes(account, store.getCredentials(accountId));
    cache.setMailboxes(accountId, boxes);
    return boxes;
  });

  handle('mail:list', async (_e, accountId, mailbox, offset, limit, query) => {
    const account = store.getAccount(accountId);
    const q = String(query || '').trim();
    const result = await backendFor(account).listMessages(
      account, store.getCredentials(accountId), mailbox, offset, limit, q
    );
    if (!q) {
      // Only unfiltered lists are cached.
      if (offset === 0) cache.setList(accountId, mailbox, result.total, result.messages);
      else cache.extendList(accountId, mailbox, result.total, result.messages);
    }
    return result;
  });

  handle('mail:fetch', async (_e, accountId, mailbox, uid) => {
    const account = store.getAccount(accountId);
    const parsed = await backendFor(account).fetchMessage(account, store.getCredentials(accountId), mailbox, uid);
    cache.setBody(accountId, mailbox, uid, parsed);
    cache.markSeen(accountId, mailbox, uid);
    return parsed;
  });

  handle('mail:flag', async (_e, accountId, mailbox, uid, flag, value) => {
    const account = store.getAccount(accountId);
    if (account.protocol === 'pop3') return; // no flags on POP3
    await imap.setFlag(account, store.getCredentials(accountId), mailbox, uid, flag, value);
    if (flag === 'seen' && value) cache.markSeen(accountId, mailbox, uid);
  });

  handle('mail:delete', async (_e, accountId, mailbox, uid) => {
    const account = store.getAccount(accountId);
    await backendFor(account).deleteMessage(account, store.getCredentials(accountId), mailbox, uid);
    cache.removeMessage(accountId, mailbox, uid);
  });

  handle('mail:emptyMailbox', async (_e, accountId, mailbox) => {
    const account = store.getAccount(accountId);
    if (account.protocol === 'pop3') throw new Error('Not available for POP3 accounts');
    await imap.emptyMailbox(account, store.getCredentials(accountId), mailbox);
    cache.clearMailbox(accountId, mailbox);
  });

  handle('mail:saveAttachment', async (event, accountId, mailbox, uid, index) => {
    const account = store.getAccount(accountId);
    const att = await backendFor(account).fetchAttachment(account, store.getCredentials(accountId), mailbox, uid, index);
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: path.basename(att.filename)
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, att.content);
    return { saved: true, path: filePath };
  });

  handle('contacts:list', () => contacts.listContacts());
  handle('contacts:add', (_e, name, address) => contacts.addContact(name, address));
  handle('contacts:remove', (_e, address) => contacts.removeContact(address));
  handle('contacts:suggest', (_e, query) => contacts.suggest(query));
  handle('contacts:has', (_e, address) => contacts.hasContact(address));

  handle('template:pickLogo', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
    });
    if (canceled || !filePaths.length) return null;
    const buf = fs.readFileSync(filePaths[0]);
    if (buf.length > 300 * 1024) throw new Error('Logo must be smaller than 300 KB.');
    const ext = path.extname(filePaths[0]).slice(1).toLowerCase().replace('jpg', 'jpeg');
    return 'data:image/' + ext + ';base64,' + buf.toString('base64');
  });

  handle('mail:pickAttachments', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections']
    });
    if (canceled) return [];
    return filePaths.map((p) => {
      let size = 0;
      try { size = fs.statSync(p).size; } catch (_) { /* leave 0 */ }
      return { path: p, filename: path.basename(p), size };
    });
  });

  handle('mail:send', async (_e, accountId, message) => {
    const account = store.getAccount(accountId);
    const credentials = store.getCredentials(accountId);
    const result = await smtp.send(account, credentials, message);
    contacts.recordRecipients([
      ...contacts.extractAddresses(message.to),
      ...contacts.extractAddresses(message.cc),
      ...contacts.extractAddresses(message.bcc)
    ]);
    if (account.protocol === 'imap') {
      // Best effort — Gmail saves sent mail itself; others need the append.
      await imap.appendMessage(account, credentials, '\\Sent', result.raw).catch(() => false);
    }
    return { messageId: result.messageId };
  });
}

module.exports = { registerIpcHandlers };
