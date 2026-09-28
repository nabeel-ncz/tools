---
title: "File Drop"
serial: "16"
slug: "file-drop"
category: "devices"
keyword: "send files between devices online"
keywordVariants:
  - "peer to peer file transfer browser"
  - "airdrop alternative for windows android"
  - "transfer files no cloud upload"
oneLine: "Send files directly between two devices over a peer-to-peer connection — the file data never touches a server."
metaDescription: "File Drop — P2P File Transfer — Free, No Cloud Upload | NABL Tools"
steps:
  - "Open this page on both devices, or scan the QR code from your sending device on the receiving one."
  - "Once paired, the two device silhouettes show a live connection."
  - "Drop a file (or several) on the sending device."
  - "The file streams directly to the other device over WebRTC and saves through the browser's normal download."
specs:
  formats: []
  maxSize: "No fixed limit — governed by both devices' memory and the peer-to-peer connection, not a server."
  browserSupport: "Any modern browser with WebRTC support: Chrome, Firefox, Safari, Edge."
  mobileNote: "Works well between a phone and a desktop — scanning the QR code from a phone is the fastest way to pair."
tips:
  - "Both devices need this page open and paired at the same time — File Drop isn't a mailbox; if one side closes the tab, the session ends."
  - "The signaling server only helps the two devices find each other (like a phone book); once connected, the file transfers directly between them, peer-to-peer."
  - "If a connection won't establish, it's usually a restrictive network (some corporate or public Wi-Fi networks block the peer-to-peer handshake) — try a different network on one side."
faq:
  - q: "Does the file pass through your servers?"
    a: "No. A small signaling server only helps two devices discover each other and negotiate a direct WebRTC connection; the actual file bytes travel peer-to-peer, never through our infrastructure."
  - q: "Do I need an account to use this?"
    a: "No — pairing is done per-session with a QR code or link; there's nothing to sign up for and nothing is stored afterward."
  - q: "Can I send to more than one device at once?"
    a: "Each session pairs two devices. For multiple recipients, open a new session per pair."
related:
  - "webcam-test"
  - "screen-recorder"
  - "screenshot-beautifier"
status: "live"
draftContent: true
---

Sending a file between your own phone and laptop shouldn't require an account, an app, or a trip through someone else's cloud storage. File Drop pairs two devices with a QR code and streams the file directly between them over WebRTC — a tiny signaling server only helps them find each other.
