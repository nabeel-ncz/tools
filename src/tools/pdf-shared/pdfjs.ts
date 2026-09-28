import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

declare global {
  interface Map<K, V> {
    // Stage-4 "Map upsert" method — not yet implemented in every browser.
    // See the polyfill below.
    getOrInsertComputed(key: K, callbackfn: (key: K) => V): V;
  }
}

// pdfjs-dist's internal code (Map/Set "upsert" helpers) calls
// `Map.prototype.getOrInsertComputed`, a very new JS built-in that some
// still-current browsers don't implement yet. Without this, page.render()
// throws "getOrInsertComputed is not a function" and every tool that renders
// a page preview breaks. Polyfill it defensively so rendering keeps working
// on browsers that haven't shipped the method yet.
if (typeof Map.prototype.getOrInsertComputed !== 'function') {
  Map.prototype.getOrInsertComputed = function <K, V>(this: Map<K, V>, key: K, callbackfn: (key: K) => V): V {
    if (!this.has(key)) {
      this.set(key, callbackfn(key));
    }
    return this.get(key) as V;
  };
}

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };

export async function loadPdf(bytes: ArrayBuffer) {
  const task = pdfjsLib.getDocument({ data: bytes });
  return task.promise;
}

export async function renderPageToCanvas(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof loadPdf>>['getPage']>>,
  scale: number
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas;
}
