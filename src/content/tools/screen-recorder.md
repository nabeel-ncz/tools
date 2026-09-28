---
title: "Screen Recorder"
serial: "01"
slug: "screen-recorder"
category: "video"
keyword: "screen recorder online"
keywordVariants:
  - "record screen without download"
  - "free screen recorder browser"
  - "screen recorder no upload no login"
oneLine: "Record your screen, a window, or a tab with mic and webcam bubble — saved straight to your device, never uploaded."
metaDescription: "Screen Recorder Online — Free, Private, No Upload | NABL Tools"
steps:
  - "Click Start and choose what to share: full screen, a window, or a browser tab."
  - "Toggle the microphone and webcam bubble on or off before you begin."
  - "Recording starts immediately — the REC light and elapsed-time readout confirm it's live."
  - "Click Stop and the recording downloads directly to your device as a video file."
specs:
  formats: ["WebM (VP9/VP8)", "MP4 where the browser supports it"]
  maxSize: "No fixed limit — recording length is bounded by available disk space and memory, not a server."
  browserSupport: "Chrome, Edge, and Firefox on desktop. Safari has partial getDisplayMedia support; behavior varies by version."
  mobileNote: "Screen recording via the browser isn't supported on mobile — use your device's built-in screen recorder instead."
tips:
  - "Sharing a single tab (not the whole screen) usually gives smoother capture and a smaller file, since the browser only has to composite one surface."
  - "The webcam bubble is drawn into the same recording — there's nothing to sync afterward, unlike overlaying a separate camera file in an editor."
  - "If system audio isn't being captured, check that you enabled 'Share tab audio' or 'Share system audio' in the browser's own share picker — that's a browser permission, not a setting on this page."
faq:
  - q: "Is my recording uploaded anywhere while I record?"
    a: "No. MediaRecorder writes the video to memory in your browser, and the Trust Meter confirms zero bytes are sent over the network for the entire session."
  - q: "What format does the download come in?"
    a: "WebM by default, since that's what MediaRecorder produces natively in most browsers. Some browsers can export MP4 directly."
  - q: "Can I record just a browser tab and not my whole desktop?"
    a: "Yes — when you click Start, the browser's own picker lets you choose a tab, a window, or the entire screen."
related:
  - "video-compressor"
  - "webcam-test"
  - "mic-test"
status: "live"
draftContent: true
---

Most screen recorders want you to install software or sign up before you can record a five-second clip. This one uses your browser's own screen-capture APIs — click Start, pick what to share, and the file saves to your device the moment you stop.
