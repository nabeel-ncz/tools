---
title: "OCR — Image & PDF to Text"
serial: "15"
slug: "ocr"
category: "image"
keyword: "ocr online free"
keywordVariants:
  - "extract text from image online"
  - "image to text converter no upload"
  - "scanned pdf to text"
oneLine: "Extract text from a photo, scan, or screenshot in English, Malayalam, Hindi, Tamil, and more — processed on your device."
metaDescription: "OCR — Extract Text from Image — Free, Private, No Upload | NABL Tools"
engineNote: "Loads a language model (~15–30MB per language) once, then works offline for that language."
steps:
  - "Drop an image, screenshot, or scanned PDF page."
  - "Pick the document's language (or languages, if mixed) from the list."
  - "Click Extract — a progress readout tracks recognition."
  - "Copy the text, or download it as a .txt file."
specs:
  formats: ["PNG, JPG, WebP, PDF (rendered page by page)"]
  maxSize: "Bounded by device memory; multi-page PDFs process one page at a time."
  browserSupport: "Any modern browser with WebAssembly support."
  mobileNote: "Works on mobile; recognition is CPU-bound so larger images take longer than on desktop."
tips:
  - "Straight, well-lit, high-contrast scans recognize far more accurately than an angled phone photo — a quick crop and straighten before running OCR pays off."
  - "Selecting the correct language matters more than image quality in many cases; recognition on the wrong language model produces garbled output even from a clean scan."
  - "For a scanned PDF that's already partly text (a hybrid scan), check whether text is already selectable before running OCR — you may not need it."
faq:
  - q: "Is my document uploaded to extract the text?"
    a: "No — recognition runs locally using Tesseract compiled to WebAssembly. Nothing is sent to a server."
  - q: "Which languages are supported?"
    a: "English plus Malayalam, Hindi, Tamil, and other Tesseract-supported languages, each loaded as a separate model on demand."
  - q: "Can it read handwriting?"
    a: "Tesseract is built for printed and typed text; handwriting recognition is unreliable and not the intended use case."
related:
  - "redact"
  - "split-pdf"
  - "transcribe"
status: "live"
draftContent: true
---

Extracting text from a scanned document or photo is exactly the kind of task where uploading the file feels wrong — IDs, bank statements, handwritten notes. This runs Tesseract locally via WebAssembly, so the image and its text never leave the browser.
