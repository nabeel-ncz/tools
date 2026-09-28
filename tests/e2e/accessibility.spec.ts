import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Result } from 'axe-core';
import fs from 'node:fs';
import path from 'node:path';

/**
 * axe-core sweep across all 21 pages (homepage, 4 category hubs, 16 tool pages).
 * Asserts zero 'serious' or 'critical' impact violations on the default render
 * of every page, and for a handful of tool pages with trivially reachable
 * interactive states (dropzone focus, command palette open), scans that
 * second state too. This is a static a11y sweep (labels, contrast, landmark
 * structure, focus order) — it does not drive full tool workflows.
 */

const ROUTES: { slug: string; path: string }[] = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '../../qa/routes.json'), 'utf-8'),
);

const RESULTS_DIR = path.resolve(import.meta.dirname, '../../qa/axe');
fs.mkdirSync(RESULTS_DIR, { recursive: true });

type ViolationSummary = { id: string; impact: string | null | undefined; help: string; nodes: number; target: string };

function seriousOrCritical(violations: Result[]): ViolationSummary[] {
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
      target: JSON.stringify(v.nodes[0]?.target ?? []),
    }));
}

for (const route of ROUTES) {
  test(`axe: ${route.slug} (${route.path}) — default state`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'load' });
    const results = await new AxeBuilder({ page }).analyze();
    fs.writeFileSync(path.join(RESULTS_DIR, `${route.slug}.json`), JSON.stringify(results, null, 2));
    const bad = seriousOrCritical(results.violations);
    expect(bad, `serious/critical violations on ${route.path}:\n${JSON.stringify(bad, null, 2)}`).toEqual([]);
  });
}

// Second-state scans for a subset of tool pages with a trivially reachable
// interacted state (no full workflow driving — just focus/open).
test('axe: home — command palette open', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.keyboard.press('/');
  // Give the palette a beat to mount/animate in.
  await page.waitForTimeout(150);
  const results = await new AxeBuilder({ page }).analyze();
  fs.writeFileSync(path.join(RESULTS_DIR, 'home--palette-open.json'), JSON.stringify(results, null, 2));
  const bad = seriousOrCritical(results.violations);
  expect(bad, `serious/critical violations with palette open:\n${JSON.stringify(bad, null, 2)}`).toEqual([]);
});

test('axe: merge-pdf — dropzone focused', async ({ page }) => {
  await page.goto('/merge-pdf/', { waitUntil: 'load' });
  const dropzone = page.locator('[role="button"], .dropzone, input[type="file"]').first();
  if (await dropzone.count()) {
    await dropzone.focus().catch(() => {});
  }
  const results = await new AxeBuilder({ page }).analyze();
  fs.writeFileSync(path.join(RESULTS_DIR, 'merge-pdf--dropzone-focused.json'), JSON.stringify(results, null, 2));
  const bad = seriousOrCritical(results.violations);
  expect(bad, `serious/critical violations with dropzone focused:\n${JSON.stringify(bad, null, 2)}`).toEqual([]);
});

test('axe: pdf-compressor — segmented toggle focused', async ({ page }) => {
  await page.goto('/pdf-compressor/', { waitUntil: 'load' });
  const toggle = page.locator('[role="radiogroup"] [role="radio"], [role="tablist"] [role="tab"], button').first();
  if (await toggle.count()) {
    await toggle.focus().catch(() => {});
  }
  const results = await new AxeBuilder({ page }).analyze();
  fs.writeFileSync(path.join(RESULTS_DIR, 'pdf-compressor--toggle-focused.json'), JSON.stringify(results, null, 2));
  const bad = seriousOrCritical(results.violations);
  expect(bad, `serious/critical violations with toggle focused:\n${JSON.stringify(bad, null, 2)}`).toEqual([]);
});
