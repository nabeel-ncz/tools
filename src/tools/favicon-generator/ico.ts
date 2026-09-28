// Minimal ICO container writer. Modern Windows/browsers accept PNG-compressed
// image data embedded directly inside an ICO's image entries (no BMP needed).
export function buildIco(pngs: { size: number; bytes: Uint8Array }[]): Uint8Array {
  const count = pngs.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * count;

  let offset = headerSize + dirSize;
  const header = new Uint8Array(headerSize + dirSize);
  const view = new DataView(header.buffer);

  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, count, true);

  let entryOffset = headerSize;
  for (const png of pngs) {
    const dim = png.size >= 256 ? 0 : png.size;
    header[entryOffset + 0] = dim; // width (0 = 256)
    header[entryOffset + 1] = dim; // height
    header[entryOffset + 2] = 0; // color palette
    header[entryOffset + 3] = 0; // reserved
    view.setUint16(entryOffset + 4, 1, true); // color planes
    view.setUint16(entryOffset + 6, 32, true); // bits per pixel
    view.setUint32(entryOffset + 8, png.bytes.byteLength, true); // size of image data
    view.setUint32(entryOffset + 12, offset, true); // offset of image data
    offset += png.bytes.byteLength;
    entryOffset += dirEntrySize;
  }

  const total = new Uint8Array(offset);
  total.set(header, 0);
  let writeOffset = headerSize + dirSize;
  for (const png of pngs) {
    total.set(png.bytes, writeOffset);
    writeOffset += png.bytes.byteLength;
  }
  return total;
}
