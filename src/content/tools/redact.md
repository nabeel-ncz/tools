---
title: "Redact"
serial: "09"
slug: "redact"
category: "pdf"
keyword: "redact pdf online"
keywordVariants:
  - "black out text in pdf"
  - "permanently remove text from pdf"
  - "redact document no upload"
oneLine: "Black out sensitive text or images in a PDF, then flatten the page to an image so the hidden content is actually gone."
metaDescription: "Redact PDF Online — Free, Private, No Upload | NABL Tools"
engineNote: "Loads a small PDF engine on first use, then works offline."
steps:
  - "Drop a PDF and open the page you need to redact."
  - "Draw black bars over the text or images to hide with the marker tool."
  - "Repeat across any other pages that need it."
  - "Click Flatten & Export — this rasterizes every redacted page so nothing can be selected or extracted underneath."
specs:
  formats: ["PDF"]
  maxSize: "Bounded by device memory; flattening many pages turns them into images, which increases file size."
  browserSupport: "Any modern browser with Canvas support."
  mobileNote: "Marker drawing works with touch; precise redaction is easier with a mouse or stylus."
tips:
  - "A black rectangle drawn in a normal PDF editor often just sits on top of the text layer — the text is still selectable underneath. This tool's export step rasterizes the page, so that failure mode isn't possible here."
  - "Flattening converts the whole page to an image, which means text elsewhere on that page stops being selectable or searchable too — expected for true redaction, but worth knowing before you export."
  - "Redact images (photos, signatures, ID scans) the same way as text — draw over them; the marker doesn't care what's underneath."
faq:
  - q: "Is this 'true' redaction, or just a black box on top?"
    a: "True redaction. Export rasterizes each redacted page into a flat image, so there's no hidden text layer left to copy or search out."
  - q: "Will the rest of the PDF's pages be affected?"
    a: "No — only pages you draw a redaction on are flattened; untouched pages keep their original text and quality."
  - q: "Can I undo a redaction before exporting?"
    a: "Yes, redactions are editable up until you click Flatten & Export; after export, the change is permanent by design."
related:
  - "sign-pdf"
  - "split-pdf"
  - "pdf-compressor"
status: "live"
draftContent: true
---

A black rectangle drawn over text in most PDF tools is cosmetic — the original text is still there, selectable and copyable underneath. This tool actually removes it: after you mark what to hide, the page is rasterized to an image, and a "verified removed" stamp confirms it.
