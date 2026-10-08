'use strict';

// Contacts and recipient history (userData/contacts.json). Every address a
// message is sent to is remembered for autocomplete; contacts are the
// addresses the user explicitly added.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const RECIPIENT_CAP = 1000;

let data = null;
let saveTimer = null;

function file() {
  return path.join(app.getPath('userData'), 'contacts.json');
}

function load() {
  if (data) return data;
  try {
    data = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch (_) { /* first run */ }
  if (!data || typeof data !== 'object') data = {};
  data.contacts = Array.isArray(data.contacts) ? data.contacts : [];
  data.recipients = data.recipients && typeof data.recipients === 'object' ? data.recipients : {};
  return data;
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const tmp = file() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(tmp, file());
    } catch (err) {
      console.error('Contacts save failed:', err.message);
    }
  }, 400);
}

function normalizeAddress(address) {
  return String(address || '').trim().toLowerCase();
}

function isValidAddress(address) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
}

// Accepts "Name <a@b.c>, d@e.f" style strings and address objects.
function extractAddresses(input) {
  const out = [];
  const push = (name, address) => {
    const addr = normalizeAddress(address);
    if (isValidAddress(addr)) out.push({ name: String(name || '').trim(), address: addr });
  };
  for (const part of String(input || '').split(',')) {
    const m = /^(.*)<([^>]+)>\s*$/.exec(part.trim());
    if (m) push(m[1].replace(/['"]/g, '').trim(), m[2]);
    else push('', part.trim());
  }
  return out;
}

function recordRecipients(addresses) {
  const d = load();
  for (const { name, address } of addresses) {
    const prev = d.recipients[address] || { name: '', count: 0, last: 0 };
    d.recipients[address] = {
      name: name || prev.name,
      count: prev.count + 1,
      last: Date.now()
    };
  }
  // Keep the history bounded: drop the least recently used.
  const keys = Object.keys(d.recipients);
  if (keys.length > RECIPIENT_CAP) {
    keys.sort((a, b) => d.recipients[a].last - d.recipients[b].last)
      .slice(0, keys.length - RECIPIENT_CAP)
      .forEach((k) => delete d.recipients[k]);
  }
  save();
}

function listContacts() {
  return load().contacts.slice().sort((a, b) =>
    (a.name || a.address).localeCompare(b.name || b.address));
}

function addContact(name, address) {
  const d = load();
  const addr = normalizeAddress(address);
  if (!isValidAddress(addr)) throw new Error('Not a valid email address');
  const existing = d.contacts.find((c) => c.address === addr);
  if (existing) {
    if (name) existing.name = String(name).trim();
  } else {
    d.contacts.push({ name: String(name || '').trim(), address: addr, added: Date.now() });
  }
  save();
  return listContacts();
}

function removeContact(address) {
  const d = load();
  d.contacts = d.contacts.filter((c) => c.address !== normalizeAddress(address));
  save();
  return listContacts();
}

function suggest(query, limit = 8) {
  const d = load();
  const q = String(query || '').trim().toLowerCase();
  const results = new Map();

  for (const c of d.contacts) {
    results.set(c.address, { name: c.name, address: c.address, isContact: true, score: 1000 });
  }
  for (const [address, info] of Object.entries(d.recipients)) {
    const existing = results.get(address);
    const score = info.count * 10 + info.last / 1e12;
    if (existing) {
      existing.score += score;
      if (!existing.name && info.name) existing.name = info.name;
    } else {
      results.set(address, { name: info.name, address, isContact: false, score });
    }
  }

  return [...results.values()]
    .filter((r) => !q || r.address.includes(q) || (r.name && r.name.toLowerCase().includes(q)))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ name, address, isContact }) => ({ name, address, isContact }));
}

function hasContact(address) {
  return load().contacts.some((c) => c.address === normalizeAddress(address));
}

module.exports = {
  extractAddresses,
  recordRecipients,
  listContacts,
  addContact,
  removeContact,
  suggest,
  hasContact
};
