---
title: "Video Trimmer & Compressor"
serial: "03"
slug: "video-compressor"
category: "video"
keyword: "compress video online"
keywordVariants:
  - "trim video online free"
  - "reduce video file size no upload"
  - "convert video to mp4 webm gif"
oneLine: "Trim a clip and shrink its file size, right in your browser — nothing is uploaded to compress it."
metaDescription: "Compress Video Online — Free, Private, No Upload | NABL Tools"
engineNote: "Loads a ~30MB video engine (ffmpeg) once, then works offline for the rest of the session."
steps:
  - "Drop a video file onto the film-strip trimmer."
  - "Drag the trim handles to set an in and out point."
  - "Set a target quality with the compression dial and pick an output format: MP4, WebM, or GIF."
  - "Click Export — the before/after size gauge shows the result, then download it."
specs:
  formats: ["MP4", "WebM", "MOV/AVI/MKV as input", "GIF export"]
  maxSize: "Depends on device RAM — ffmpeg.wasm holds the working file in memory; very large 4K files may be slow or fail on low-memory devices."
  browserSupport: "Chrome, Edge, and Firefox with SharedArrayBuffer support (required for multithreaded encoding). Safari support is more limited."
  mobileNote: "Works on capable phones but is significantly slower than desktop; large files may run out of memory on older devices."
tips:
  - "Trimming happens before compressing, so cutting a long recording down first is the fastest way to shrink a file — you're not re-encoding footage you don't need."
  - "GIF export is best for short clips under ~10 seconds; GIF has no real compression for motion, so longer exports get large fast."
  - "If export is slow, check whether your browser supports SharedArrayBuffer — without it, ffmpeg.wasm falls back to a single-threaded, slower path."
faq:
  - q: "Is my video uploaded to a server to compress it?"
    a: "No — this runs ffmpeg compiled to WebAssembly, executing entirely inside your browser tab. The Trust Meter confirms nothing is sent over the network during processing."
  - q: "How long does compression take?"
    a: "Roughly proportional to video length and your device's CPU — expect it to take a noticeable fraction of the video's own runtime, longer on older hardware."
  - q: "Why does the tool need to download something first?"
    a: "The ffmpeg engine itself is a ~30MB WebAssembly module. It's fetched once and cached by your browser, so repeat visits skip the download."
related:
  - "screen-recorder"
  - "webcam-test"
  - "pdf-compressor"
status: "live"
draftContent: true
---

Compressing a video usually means uploading it to a website and waiting in a queue — a bad idea for anything personal, and slow either way. This tool runs a real video encoder (ffmpeg) inside your browser via WebAssembly, so trimming and compressing happen on your own machine.
