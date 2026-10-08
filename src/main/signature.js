'use strict';

// Builds the signature from the account template. When structured details
// (name, title, company, phone) are set, a tidy default layout is
// generated from whichever fields were provided; otherwise the free-text
// signature is used as-is.

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function buildSignatureText(t) {
  if (!t) return '';
  if (!t.sigName) return t.signature || '';
  const lines = [];
  if (t.signature) lines.push(t.signature.trim(), '');
  lines.push(t.sigName);
  const role = [t.sigTitle, t.sigCompany].filter(Boolean).join(', ');
  if (role) lines.push(role);
  if (t.sigPhone) lines.push(t.sigPhone);
  return lines.join('\n');
}

// HTML version for styled emails. logoSrc is the img src to use
// (a cid: reference when sending, or a data: URL for previews).
function buildSignatureHtml(t, logoSrc) {
  if (!t) return '';
  if (!t.sigName) {
    return t.signature
      ? '<div style="white-space:pre-wrap;">' + escapeHtml(t.signature) + '</div>'
      : '';
  }
  const parts = [];
  if (t.signature) {
    parts.push('<div style="white-space:pre-wrap;margin-bottom:12px;">' +
      escapeHtml(t.signature.trim()) + '</div>');
  }
  const logo = logoSrc
    ? '<td style="padding-right:14px;vertical-align:middle;">' +
      '<img src="' + logoSrc + '" alt="" style="max-height:52px;max-width:120px;display:block;"></td>'
    : '';
  const role = [t.sigTitle, t.sigCompany].filter(Boolean).map(escapeHtml).join(', ');
  const details =
    '<td style="vertical-align:middle;">' +
    '<div style="font-weight:600;font-size:15px;">' + escapeHtml(t.sigName) + '</div>' +
    (role ? '<div style="opacity:0.75;font-size:13px;">' + role + '</div>' : '') +
    (t.sigPhone
      ? '<div style="opacity:0.75;font-size:13px;">' +
        '<a href="tel:' + escapeHtml(t.sigPhone.replace(/[^+\d]/g, '')) + '" ' +
        'style="color:inherit;text-decoration:none;">' + escapeHtml(t.sigPhone) + '</a></div>'
      : '') +
    '</td>';
  parts.push('<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
    logo + details + '</tr></table>');
  return parts.join('');
}

module.exports = { buildSignatureText, buildSignatureHtml, escapeHtml };
