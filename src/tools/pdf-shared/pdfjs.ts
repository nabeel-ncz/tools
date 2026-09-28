import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

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
