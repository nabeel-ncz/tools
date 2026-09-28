---
title: "Mic Test"
serial: "12"
slug: "mic-test"
category: "devices"
keyword: "mic test online"
keywordVariants:
  - "test my microphone online"
  - "check microphone before meeting"
  - "microphone not working browser test"
oneLine: "Watch a live input level meter to check your microphone volume and clarity before a call — audio never leaves your device."
metaDescription: "Test Your Microphone Online — Free, Private, No Upload | NABL Tools"
steps:
  - "Allow microphone access when prompted."
  - "Pick an input device if you have more than one."
  - "Talk normally and watch the VU meter — it should sit comfortably in the mid-range, not pinned to the top."
  - "Use the playback button to hear a short local recording of yourself."
specs:
  formats: []
  browserSupport: "Any browser supporting getUserMedia: Chrome, Firefox, Safari, Edge."
  mobileNote: "Works on mobile browsers; headset mics are detected as separate input devices where the OS exposes them."
tips:
  - "If the meter barely moves, check your OS input volume first — most 'broken mic' reports are a volume slider at zero, not a hardware fault."
  - "A meter that's constantly pinned red means you're clipping; step back from the mic or lower the input gain in your OS settings."
  - "Bluetooth headsets often switch to a lower-quality call profile the moment a mic is active — if voice quality drops when you unmute, that's why."
faq:
  - q: "Is my voice recorded or uploaded?"
    a: "No audio leaves your device. Levels are read directly from the Web Audio API in your browser, and the optional playback clip stays in local memory until you close the tab."
  - q: "Why does the meter jump even when I'm not talking?"
    a: "Fans, keyboard clicks, and room echo all register. If the noise floor is high, try a wired headset or move away from fans and vents."
  - q: "Can I test two microphones at once?"
    a: "Switch the source dropdown to compare devices one at a time — browsers only expose one active input stream per test."
related:
  - "webcam-test"
  - "screen-recorder"
  - "transcribe"
status: "live"
draftContent: true
---

Before a call, it's easier to trust a meter than to trust "can you hear me?" This page reads your microphone's input level in real time so you can see — not guess — whether you're too quiet, too loud, or clipping, all without sending a single sample anywhere.
