'use strict';

// Shared serialization of parsed messages (used by IMAP and POP3 backends).
// Inline "cid:" images are embedded as data: URIs so HTML bodies render
// with images in the right places, and those parts are hidden from the
// attachment list.

const INLINE_LIMIT = 2 * 1024 * 1024; // per-image cap for data: embedding

function cleanName(name) {
  return String(name || '').replace(/^['"\s]+|['"\s]+$/g, '');
}

function flattenAddresses(obj, out) {
  if (!obj) return out;
  for (const entry of Array.isArray(obj) ? obj : [obj]) {
    for (const v of entry.value || []) {
      if (v.group) flattenAddresses({ value: v.group }, out);
      else if (v.address || v.name) out.push({ name: cleanName(v.name), address: v.address || '' });
    }
  }
  return out;
}

function addressText(addr) {
  if (!addr) return '';
  if (Array.isArray(addr)) return addr.map((a) => a.text).filter(Boolean).join(', ');
  return addr.text || '';
}

function serializeParsed(parsed) {
  const attachments = parsed.attachments || [];
  let html = typeof parsed.html === 'string' ? parsed.html : null;
  const inline = new Set();

  if (html) {
    for (const att of attachments) {
      // mailparser embeds cid-referenced images into parsed.html itself and
      // flags them `related`; hide those from the attachment list.
      if (att.related) {
        inline.add(att);
        continue;
      }
      // Fallback for cid references mailparser left untouched.
      const cid = att.cid || (att.contentId ? String(att.contentId).replace(/[<>]/g, '') : null);
      if (!cid || !att.content || att.content.length > INLINE_LIMIT) continue;
      const marker = 'cid:' + cid;
      if (html.includes(marker)) {
        const dataUri = 'data:' + (att.contentType || 'image/png') + ';base64,' +
          att.content.toString('base64');
        html = html.split(marker).join(dataUri);
        inline.add(att);
      }
    }
  }

  return {
    subject: parsed.subject || '(no subject)',
    from: parsed.from ? parsed.from.text : '',
    fromAddr: flattenAddresses(parsed.from, []),
    to: addressText(parsed.to),
    toAddr: flattenAddresses(parsed.to, []),
    cc: addressText(parsed.cc),
    ccAddr: flattenAddresses(parsed.cc, []),
    date: parsed.date ? parsed.date.toISOString() : null,
    messageId: parsed.messageId || null,
    inReplyTo: parsed.inReplyTo || null,
    references: parsed.references || null,
    html,
    text: parsed.text || '',
    // index stays the position in the full attachment array so downloads
    // keep working even though inline images are hidden here.
    attachments: attachments
      .map((att, i) => ({ att, i }))
      .filter(({ att }) => !inline.has(att))
      .map(({ att, i }) => ({
        index: i,
        filename: att.filename || `attachment-${i + 1}`,
        contentType: att.contentType || 'application/octet-stream',
        size: att.size || (att.content ? att.content.length : 0)
      }))
  };
}

module.exports = { serializeParsed, cleanName };
