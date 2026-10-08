'use strict';

const { ipcMain, dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { detectProvider } = require('./providers');
const cache = require('./cache');
const imap = require('./mail/imap');
const pop3 = require('./mail/pop3');
const smtp = require('./mail/smtp');

function backendFor(account) {
  return account.protocol === 'pop3' ? pop3 : imap;
}

function friendlyError(err) {
  const msg = (err && err.message) || String(err);
  if (/auth|login|credential|password|535|invalid/i.test(msg)) {
    return 'Sign-in failed — check your email, password (many providers need an app password), and server settings. (' + msg + ')';
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
      return { ok: false, error: friendlyError(err) };
    }
  });
}

function registerIpcHandlers() {
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
    if (account.protocol === 'imap') {
      // Best effort — Gmail saves sent mail itself; others need the append.
      await imap.appendMessage(account, credentials, '\\Sent', result.raw).catch(() => false);
    }
    return { messageId: result.messageId };
  });
}

module.exports = { registerIpcHandlers };
