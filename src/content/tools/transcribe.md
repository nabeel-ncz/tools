---
title: "Audio/Video Transcriber"
serial: "02"
slug: "transcribe"
category: "video"
keyword: "transcribe audio to text online"
keywordVariants:
  - "video to text converter free"
  - "generate subtitles from video"
  - "transcribe audio no upload private"
oneLine: "Turn speech in an audio or video file into text, with SRT/VTT subtitle export — transcribed on your device with Whisper."
metaDescription: "Transcribe Audio to Text — Free, Private, No Upload | NABL Tools"
engineNote: "Loads a Whisper speech model (100–300MB depending on quality) once, then works offline."
steps:
  - "Drop an audio or video file onto the waveform."
  - "Pick a model size: faster/smaller or slower/more accurate."
  - "Click Transcribe and watch the transcript scroll in sync with the waveform as it processes."
  - "Export as plain text, SRT, or VTT subtitles."
specs:
  formats: ["MP3, WAV, M4A, MP4, WebM, and most browser-playable audio/video"]
  maxSize: "Practically limited by device memory; long files (1hr+) take proportionally longer and use more RAM."
  browserSupport: "Best on Chrome/Edge with WebGPU for speed; falls back to a slower WASM path on browsers without WebGPU (including current Safari)."
  mobileNote: "Works on capable phones with the smallest model; larger models are impractical on mobile hardware."
tips:
  - "The smallest model is noticeably faster but makes more mistakes on accents, background noise, and technical vocabulary — use a larger model when accuracy matters more than speed."
  - "Background music or overlapping speakers reduce accuracy more than audio quality does; a clean single-speaker recording transcribes best regardless of model size."
  - "WebGPU (when available) is several times faster than the WASM fallback — if transcription feels slow, check whether your browser and GPU support it."
faq:
  - q: "Is my audio or video uploaded to transcribe it?"
    a: "No. Transcription runs Whisper entirely in your browser via transformers.js — WebGPU when available, WASM otherwise. Nothing is sent over the network during processing."
  - q: "Why does it need to download a model first?"
    a: "The speech-recognition model itself is 100–300MB depending on the quality tier you pick. It's downloaded once and cached, so later visits and later files skip that step."
  - q: "Which languages are supported?"
    a: "Whisper supports dozens of languages; recognition quality varies by language and is generally strongest for widely-spoken ones with more training data."
related:
  - "screen-recorder"
  - "video-compressor"
  - "ocr"
status: "live"
draftContent: true
---

Sending a recording to a transcription service means trusting a third party with everything said in it. This tool runs OpenAI's Whisper model directly in your browser, so the audio and the resulting transcript never leave your device.
