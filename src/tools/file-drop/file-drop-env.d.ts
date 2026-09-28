// Ambient type declarations local to the File Drop tool.

// `qrcode` ships no bundled types and this repo intentionally avoids adding
// a new devDependency (@types/qrcode) for a single tool — see
// workers/filedrop/README.md for why. This is a minimal surface covering
// only the browser APIs FileDrop.svelte actually calls.
declare module 'qrcode' {
  export interface QRCodeRenderOptions {
    width?: number;
    margin?: number;
    errorCorrectionLevel?: 'low' | 'medium' | 'quartile' | 'high' | 'L' | 'M' | 'Q' | 'H';
    color?: {
      dark?: string;
      light?: string;
    };
  }

  export function toCanvas(
    canvas: HTMLCanvasElement,
    text: string,
    options?: QRCodeRenderOptions,
  ): Promise<HTMLCanvasElement>;

  export function toDataURL(text: string, options?: QRCodeRenderOptions): Promise<string>;

  const QRCode: {
    toCanvas: typeof toCanvas;
    toDataURL: typeof toDataURL;
  };

  export default QRCode;
}

// Build-time signaling server URL for File Drop, e.g.
// `wss://signal.tools.nabl.in/ws/filedrop`. Set via a `PUBLIC_SIGNALING_URL`
// env var at `astro build` time — see workers/filedrop/README.md. Falls back
// to a same-origin `/ws/filedrop` path (which only works once the Worker is
// deployed and proxied at that path) when unset.
interface ImportMetaEnv {
  readonly PUBLIC_SIGNALING_URL?: string;
}
