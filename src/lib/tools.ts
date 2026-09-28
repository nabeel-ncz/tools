import { getCollection, type CollectionEntry } from 'astro:content';

export type ToolEntry = CollectionEntry<'tools'>;

export const CATEGORIES: Record<
  string,
  { title: string; intro: string; order: number }
> = {
  video: {
    title: 'Video & Screen',
    intro:
      'Record, trim, compress, and transcribe video and audio — all processed on your own device, never uploaded to render or encode.',
    order: 1,
  },
  pdf: {
    title: 'PDF',
    intro:
      'Compress, merge, split, sign, and redact PDFs locally. Nothing you drop here is sent to a server to be read.',
    order: 2,
  },
  image: {
    title: 'Image',
    intro:
      'Remove backgrounds, upscale, extract text, and frame images and icons — full resolution, processed in your browser.',
    order: 3,
  },
  devices: {
    title: 'Devices',
    intro:
      'Test your camera and microphone, and send files directly between your own devices without a cloud in between.',
    order: 4,
  },
};

export async function getLiveTools(): Promise<ToolEntry[]> {
  const all = await getCollection('tools', ({ data }) => data.status === 'live');
  return all.sort((a, b) => a.data.serial.localeCompare(b.data.serial));
}

export async function getAllToolsIncludingPlanned(): Promise<ToolEntry[]> {
  const all = await getCollection('tools');
  return all.sort((a, b) => a.data.serial.localeCompare(b.data.serial));
}

export function toolUrl(slug: string): string {
  return `/${slug}`;
}

export function paletteItems(tools: ToolEntry[]) {
  return tools.map((t) => ({
    title: t.data.title,
    serial: `No. ${t.data.serial}`,
    url: toolUrl(t.slug),
    category: CATEGORIES[t.data.category]?.title ?? t.data.category,
    keyword: t.data.keyword,
  }));
}
