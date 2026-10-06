'use strict';

// Account storage. Non-secret settings live in accounts.json under the
// Electron userData dir; passwords are encrypted with Electron safeStorage
// (libsecret / kwallet backed) when available.

const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function storeFile() {
  return path.join(app.getPath('userData'), 'accounts.json');
}

function readStore() {
  try {
    const raw = fs.readFileSync(storeFile(), 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data.accounts)) return data;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Failed to read account store:', err);
  }
  return { accounts: [] };
}

function writeStore(data) {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function encryptSecret(plain) {
  if (safeStorage.isEncryptionAvailable()) {
    return { enc: 'safeStorage', data: safeStorage.encryptString(plain).toString('base64') };
  }
  // Last resort so the app still works on systems without a keyring.
  return { enc: 'plain', data: Buffer.from(plain, 'utf8').toString('base64') };
}

function decryptSecret(secret) {
  if (!secret) return '';
  if (secret.enc === 'safeStorage') {
    return safeStorage.decryptString(Buffer.from(secret.data, 'base64'));
  }
  return Buffer.from(secret.data, 'base64').toString('utf8');
}

function sanitize(account) {
  // Shape sent to the renderer — never includes the password.
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    protocol: account.protocol,
    incoming: account.incoming,
    smtp: { host: account.smtp.host, port: account.smtp.port, security: account.smtp.security },
    passwordStored: Boolean(account.secret)
  };
}

function listAccounts() {
  return readStore().accounts.map(sanitize);
}

function getAccount(id) {
  const account = readStore().accounts.find((a) => a.id === id);
  if (!account) throw new Error('Account not found');
  return account;
}

function getCredentials(id) {
  const account = getAccount(id);
  return { user: account.loginUser || account.email, password: decryptSecret(account.secret) };
}

function addAccount(input) {
  const store = readStore();
  const account = {
    id: crypto.randomUUID(),
    name: String(input.name || input.email),
    email: String(input.email),
    loginUser: String(input.loginUser || input.email),
    protocol: input.protocol === 'pop3' ? 'pop3' : 'imap',
    incoming: {
      host: String(input.incoming.host),
      port: Number(input.incoming.port),
      security: input.incoming.security === 'starttls' ? 'starttls' : 'ssl'
    },
    smtp: {
      host: String(input.smtp.host),
      port: Number(input.smtp.port),
      security: input.smtp.security === 'ssl' ? 'ssl' : 'starttls'
    },
    secret: encryptSecret(String(input.password))
  };
  store.accounts.push(account);
  writeStore(store);
  return sanitize(account);
}

function updateAccount(id, input) {
  const store = readStore();
  const account = store.accounts.find((a) => a.id === id);
  if (!account) throw new Error('Account not found');
  if (input.name) account.name = String(input.name);
  if (input.loginUser) account.loginUser = String(input.loginUser);
  if (input.incoming) {
    account.incoming = {
      host: String(input.incoming.host),
      port: Number(input.incoming.port),
      security: input.incoming.security === 'starttls' ? 'starttls' : 'ssl'
    };
  }
  if (input.smtp) {
    account.smtp = {
      host: String(input.smtp.host),
      port: Number(input.smtp.port),
      security: input.smtp.security === 'ssl' ? 'ssl' : 'starttls'
    };
  }
  if (input.password) account.secret = encryptSecret(String(input.password));
  writeStore(store);
  return sanitize(account);
}

function removeAccount(id) {
  const store = readStore();
  store.accounts = store.accounts.filter((a) => a.id !== id);
  writeStore(store);
}

module.exports = {
  listAccounts,
  getAccount,
  getCredentials,
  addAccount,
  updateAccount,
  removeAccount
};
