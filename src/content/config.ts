import { defineCollection, z } from 'astro:content';

const tools = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    serial: z.string(),
    category: z.enum(['video', 'pdf', 'image', 'devices']),
    keyword: z.string(),
    keywordVariants: z.array(z.string()).default([]),
    oneLine: z.string(),
    metaDescription: z.string().max(155),
    engineNote: z.string().optional(),
    steps: z.array(z.string()).min(1),
    specs: z.object({
      formats: z.array(z.string()).default([]),
      maxSize: z.string().optional(),
      browserSupport: z.string(),
      mobileNote: z.string().optional(),
    }),
    tips: z.array(z.string()).default([]),
    faq: z
      .array(
        z.object({
          q: z.string(),
          a: z.string(),
        })
      )
      .default([]),
    related: z.array(z.string()).default([]),
    status: z.enum(['live', 'planned']).default('live'),
    draftContent: z.boolean().default(false),
  }),
});

export const collections = { tools };
