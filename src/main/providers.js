'use strict';

// Known-provider presets so most people can sign in with just an address
// and password (or app password). Matched by the address's domain.

const PRESETS = [
  {
    domains: ['gmail.com', 'googlemail.com'],
    label: 'Gmail',
    note: 'Gmail requires an App Password (Google Account → Security → 2-Step Verification → App passwords).',
    imap: { host: 'imap.gmail.com', port: 993, security: 'ssl' },
    pop3: { host: 'pop.gmail.com', port: 995, security: 'ssl' },
    smtp: { host: 'smtp.gmail.com', port: 465, security: 'ssl' }
  },
  {
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'outlook.de', 'hotmail.co.uk'],
    label: 'Outlook.com',
    note: 'Microsoft accounts may require an app password if two-step verification is on.',
    imap: { host: 'outlook.office365.com', port: 993, security: 'ssl' },
    pop3: { host: 'outlook.office365.com', port: 995, security: 'ssl' },
    smtp: { host: 'smtp-mail.outlook.com', port: 587, security: 'starttls' }
  },
  {
    domains: ['yahoo.com', 'yahoo.co.uk', 'ymail.com', 'rocketmail.com'],
    label: 'Yahoo Mail',
    note: 'Yahoo requires an app password (Account Security → Generate app password).',
    imap: { host: 'imap.mail.yahoo.com', port: 993, security: 'ssl' },
    pop3: { host: 'pop.mail.yahoo.com', port: 995, security: 'ssl' },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, security: 'ssl' }
  },
  {
    domains: ['icloud.com', 'me.com', 'mac.com'],
    label: 'iCloud Mail',
    note: 'iCloud requires an app-specific password (appleid.apple.com → Sign-In and Security).',
    imap: { host: 'imap.mail.me.com', port: 993, security: 'ssl' },
    pop3: null,
    smtp: { host: 'smtp.mail.me.com', port: 587, security: 'starttls' }
  },
  {
    domains: ['aol.com'],
    label: 'AOL Mail',
    note: 'AOL requires an app password.',
    imap: { host: 'imap.aol.com', port: 993, security: 'ssl' },
    pop3: { host: 'pop.aol.com', port: 995, security: 'ssl' },
    smtp: { host: 'smtp.aol.com', port: 465, security: 'ssl' }
  },
  {
    domains: ['gmx.com', 'gmx.net', 'gmx.de'],
    label: 'GMX',
    note: 'Enable POP3/IMAP access in GMX settings first.',
    imap: { host: 'imap.gmx.com', port: 993, security: 'ssl' },
    pop3: { host: 'pop.gmx.com', port: 995, security: 'ssl' },
    smtp: { host: 'mail.gmx.com', port: 587, security: 'starttls' }
  },
  {
    domains: ['mail.com'],
    label: 'Mail.com',
    note: 'Enable POP3/IMAP access in Mail.com settings first.',
    imap: { host: 'imap.mail.com', port: 993, security: 'ssl' },
    pop3: { host: 'pop.mail.com', port: 995, security: 'ssl' },
    smtp: { host: 'smtp.mail.com', port: 587, security: 'starttls' }
  },
  {
    domains: ['zoho.com', 'zohomail.com'],
    label: 'Zoho Mail',
    note: 'Enable IMAP access in Zoho Mail settings; app password needed with MFA.',
    imap: { host: 'imap.zoho.com', port: 993, security: 'ssl' },
    pop3: { host: 'pop.zoho.com', port: 995, security: 'ssl' },
    smtp: { host: 'smtp.zoho.com', port: 465, security: 'ssl' }
  },
  {
    domains: ['fastmail.com', 'fastmail.fm'],
    label: 'Fastmail',
    note: 'Fastmail requires an app password (Settings → Privacy & Security).',
    imap: { host: 'imap.fastmail.com', port: 993, security: 'ssl' },
    pop3: { host: 'pop.fastmail.com', port: 995, security: 'ssl' },
    smtp: { host: 'smtp.fastmail.com', port: 465, security: 'ssl' }
  },
  {
    domains: ['protonmail.com', 'proton.me', 'pm.me'],
    label: 'Proton Mail (Bridge)',
    note: 'Proton requires the Proton Mail Bridge app running locally; use the Bridge credentials.',
    imap: { host: '127.0.0.1', port: 1143, security: 'starttls' },
    pop3: null,
    smtp: { host: '127.0.0.1', port: 1025, security: 'starttls' }
  }
];

function detectProvider(email) {
  const at = String(email).lastIndexOf('@');
  if (at < 0) return null;
  const domain = String(email).slice(at + 1).toLowerCase();
  const preset = PRESETS.find((p) => p.domains.includes(domain));
  if (preset) {
    return {
      label: preset.label,
      note: preset.note,
      imap: preset.imap,
      pop3: preset.pop3,
      smtp: preset.smtp
    };
  }
  // Generic guess for unknown domains — common convention hosts.
  return {
    label: null,
    note: 'Settings guessed from your domain — adjust them if sign-in fails.',
    imap: { host: 'imap.' + domain, port: 993, security: 'ssl' },
    pop3: { host: 'pop.' + domain, port: 995, security: 'ssl' },
    smtp: { host: 'smtp.' + domain, port: 587, security: 'starttls' }
  };
}

module.exports = { detectProvider };
