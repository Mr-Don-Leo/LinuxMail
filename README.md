# LinuxMail ✉

A desktop email client for Linux. Sign in with **any** email account — Gmail, Outlook, Yahoo, iCloud, your own domain — using **IMAP** or **POP3** for receiving and **SMTP** for sending.

![Electron](https://img.shields.io/badge/built%20with-Electron-47848F) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Any email provider** — auto-detected settings for Gmail, Outlook/Hotmail, Yahoo, iCloud, AOL, GMX, Mail.com, Zoho, Fastmail and Proton (via Bridge), plus full manual server configuration for everything else.
- **IMAP** — folders, unread counts, read/unread state, starring, delete-to-trash, paging through large mailboxes.
- **POP3** — for providers or setups where you want simple download-style access.
- **SMTP sending** — compose, reply (with quoting and proper threading headers), forward, attachments, Cc/Bcc. Sent messages are saved to your Sent folder on IMAP accounts.
- **Multiple accounts** side by side.
- **Attachments** — view and save received attachments, attach files when composing.
- **Safe message viewing** — HTML mail is rendered in a fully sandboxed frame with scripts blocked and remote tracking images not loaded.
- **Secure credential storage** — passwords are encrypted with the system keyring (libsecret/KWallet) via Electron `safeStorage`.

## Install

Grab the latest release from the [Releases page](https://github.com/Mr-Don-Leo/LinuxMail/releases):

### AppImage (any distro)

```bash
chmod +x LinuxMail-*.AppImage
./LinuxMail-*.AppImage
```

### RPM (Fedora, openSUSE, RHEL…)

```bash
sudo rpm -i LinuxMail-*.rpm        # or: sudo dnf install ./LinuxMail-*.rpm
```

## Signing in

1. Click **+** in the sidebar.
2. Enter your email address and password — server settings are filled in automatically for common providers.
3. For Gmail, Yahoo, iCloud and AOL you need an **app password** (regular passwords are rejected by those providers):
   - Gmail: Google Account → Security → 2-Step Verification → App passwords
   - Yahoo: Account Security → Generate app password
   - iCloud: appleid.apple.com → Sign-In and Security → App-Specific Passwords
4. For any other provider, open **Server settings** in the dialog and enter your IMAP/POP3 and SMTP hosts.

## Building from source

```bash
git clone https://github.com/Mr-Don-Leo/LinuxMail.git
cd LinuxMail
npm install
npm run icon      # generate the app icon
npm start         # run in development
```

### Building release packages

```bash
npm run dist              # AppImage + RPM
npm run dist:appimage     # AppImage only
npm run dist:rpm          # RPM only (needs rpmbuild installed)
```

Packages land in `dist/`.

### Automated releases

Pushing a tag like `v1.0.0` triggers the GitHub Actions workflow, which builds the AppImage and RPM and attaches them to a GitHub Release automatically:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Tech

- [Electron](https://www.electronjs.org/) — app shell
- [ImapFlow](https://imapflow.com/) — IMAP
- [node-pop3](https://www.npmjs.com/package/node-pop3) — POP3
- [Nodemailer](https://nodemailer.com/) — SMTP
- [mailparser](https://nodemailer.com/extras/mailparser/) — MIME parsing

## License

MIT
