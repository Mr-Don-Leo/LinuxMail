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
  listMessages: (accountId, mailbox, offset, limit) => call('mail:list', accountId, mailbox, offset, limit),
  fetchMessage: (accountId, mailbox, uid) => call('mail:fetch', accountId, mailbox, uid),
  setFlag: (accountId, mailbox, uid, flag, value) => call('mail:flag', accountId, mailbox, uid, flag, value),
  deleteMessage: (accountId, mailbox, uid) => call('mail:delete', accountId, mailbox, uid),
  saveAttachment: (accountId, mailbox, uid, index) => call('mail:saveAttachment', accountId, mailbox, uid, index),
  pickAttachments: () => call('mail:pickAttachments'),
  sendMessage: (accountId, message) => call('mail:send', accountId, message)
});
