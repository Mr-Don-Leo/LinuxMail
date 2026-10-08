'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

contextBridge.exposeInMainWorld('mailApi', {
  listAccounts: () => call('accounts:list'),
  detectProvider: (email) => call('accounts:detect', email),
  addAccount: (input) => call('accounts:add', input),
  updateAccount: (id, input) => call('accounts:update', id, input),
  removeAccount: (id) => call('accounts:remove', id),

  listMailboxes: (accountId) => call('mail:mailboxes', accountId),
  cachedMailboxes: (accountId) => call('mail:cachedMailboxes', accountId),
  cachedList: (accountId, mailbox) => call('mail:cachedList', accountId, mailbox),
  cachedBody: (accountId, mailbox, uid) => call('mail:cachedBody', accountId, mailbox, uid),
  listMessages: (accountId, mailbox, offset, limit, query) => call('mail:list', accountId, mailbox, offset, limit, query),
  fetchMessage: (accountId, mailbox, uid) => call('mail:fetch', accountId, mailbox, uid),
  setFlag: (accountId, mailbox, uid, flag, value) => call('mail:flag', accountId, mailbox, uid, flag, value),
  deleteMessage: (accountId, mailbox, uid) => call('mail:delete', accountId, mailbox, uid),
  emptyMailbox: (accountId, mailbox) => call('mail:emptyMailbox', accountId, mailbox),
  saveAttachment: (accountId, mailbox, uid, index) => call('mail:saveAttachment', accountId, mailbox, uid, index),
  pickAttachments: () => call('mail:pickAttachments'),
  sendMessage: (accountId, message) => call('mail:send', accountId, message),

  listContacts: () => call('contacts:list'),
  addContact: (name, address) => call('contacts:add', name, address),
  removeContact: (address) => call('contacts:remove', address),
  suggestRecipients: (query) => call('contacts:suggest', query),
  hasContact: (address) => call('contacts:has', address),
  pickLogo: () => call('template:pickLogo'),

  windowControl: (action) => call('window:control', action),
  appAction: (action) => call('app:action', action),
  onWindowMaximized: (cb) => ipcRenderer.on('window:maximized', (_e, value) => cb(value))
});
