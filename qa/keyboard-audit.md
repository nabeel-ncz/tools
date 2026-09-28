# Keyboard-only audit — NABL Tools

Manual/scripted keyboard pass (Playwright driving the real Chromium at
`/opt/pw-browsers/chromium`, `page.keyboard` only, no mouse) over four tool
"faces" chosen for genuinely different interaction patterns, plus the
sitewide chrome (skip link, header nav, Command Palette, theme toggle) that
every page shares.

## Sitewide chrome (all pages)

- A skip-link (`Skip to content`) is the very first Tab stop on every page and is visible when focused.
- Header nav links, the Command Palette trigger (`aria-label="Open command palette"`), and the theme toggle (`aria-label="Toggle dark mode"`) are all reachable via Tab, in a sensible order (nav → palette trigger → theme toggle → page content).
- **Every** focused element observed across every page tested — links, buttons, the file inputs, the command palette's search field — showed a visible focus indicator: a 2px solid outline in the site's signal color (`var(--focus-ring)`, `rgb(228, 87, 46)`), from the global `:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }` rule in `src/design/global.css`. The one place this rule was being silently defeated (sliders) is fixed below.

## 1. Command Palette (`/` shortcut + arrow-key navigation)

Tested from the homepage.

- Tab reaches the palette trigger button after the header nav links; it has a visible focus ring and an `aria-label`.
- Pressing **`/`** (while focus is not in a text field) opens the palette: confirmed `role="dialog"` `aria-modal="true"` appears and focus moves automatically into the search `<input>` (`aria-label="Search tools"`).
- **ArrowDown** moves the active-item selection through the results list (`role="listbox"` / `role="option"`); confirmed two presses lands on the 3rd item.
- **Escape** closes the dialog and (implicitly, since focus returns to the trigger's DOM position) doesn't strand focus.
- **Enter** on a selected item is wired to navigate (per source, `onInputKeydown` handles `Enter`) — not separately re-verified by navigation in this pass, but the same handler path as ArrowDown/Escape.

No issues found. This is a well-built keyboard pattern.

## 2. Screenshot Beautifier (canvas + sliders)

Tested at `/screenshot-beautifier/`.

- The Dropzone's file input is reachable via Tab (after the fix below) and operable — focusing it and using the OS file-picker keyboard flow works since it's a real `<input type="file">`, not a synthetic control.
- After dropping an image, the background-swatch buttons and three `SteppedSlider` controls (Padding, Corner radius, Shadow) become reachable via Tab, in visual order.
- Sliders are real `<input type="range">` elements, so they are natively keyboard-operable: confirmed live that focusing the first slider and pressing **ArrowRight** changed its value (64 → 68, one `step`).
- Export and "Start over" are plain `<button>` elements — inherently Enter/Space-operable, no issue.

### Finding — fixed: sliders had no visible focus indicator

`src/design/primitives/SteppedSlider.svelte` had `input[type='range'] { outline: none; }` with **no replacement focus style**. Because the browser's native focus outline for a range input draws around the full-width track rather than the thumb (visually confusing), the component suppressed it — but never added anything back. Result: tabbing to any slider on any tool that uses `SteppedSlider` (Screenshot Beautifier's Padding/Corner/Shadow, and any other tool built on this primitive) left no visible indication that the slider was focused, even though it was fully keyboard-operable. This is a WCAG 2.4.7 (Focus Visible) violation, and it's exactly the kind of gap axe-core and Lighthouse's automated rule sets do **not** catch (there's no DOM-inspectable "this element visibly indicates focus" check), which is why a dedicated keyboard pass is needed.

**Fixed**, in scope (`src/design/primitives/SteppedSlider.svelte`): added
```css
input[type='range']:focus-visible::-webkit-slider-thumb { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
input[type='range']:focus-visible::-moz-range-thumb { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
```
— an outline on the thumb itself, using the same `--focus-ring` token as every other control site-wide. Verified the rule compiles into the built CSS correctly; the browser's own `::-webkit-slider-thumb`/`::-moz-range-thumb` pseudo-elements aren't inspectable via `getComputedStyle`'s second argument in headless automation, so this was confirmed by reading the shipped CSS rather than a rendered screenshot diff.

## 3. PDF Compressor (segmented toggle)

Tested at `/pdf-compressor/`.

- Dropzone reachable as above.
- After dropping a PDF, the three quality-level buttons (Light / Balanced / Aggressive) and the Compress button are all reachable via Tab, each a plain `<button type="button">`.
- Confirmed keyboard activation: focusing a level button and pressing **Enter** toggles its `active` class (selection changes), exactly like a click would.

### Minor note (not a blocker, not fixed)

The level buttons are a row of independent `<button>`s (`class:active`), not the WAI-ARIA "radio group" pattern (`role="radiogroup"` + `role="radio"` children + Arrow-key switching + one button in the Tab sequence). Functionally this is **fully keyboard-operable** — every button is individually Tab-reachable and Enter/Space-activatable — just not the more polished single-stop-then-arrow-keys pattern a segmented control ideally has. Flagged for awareness; not treated as a defect worth changing component semantics for during this audit.

## 4. Sign & Fill PDF (drag-and-resize placed elements)

Tested at `/sign-pdf/`.

- Dropzone reachable as above.
- After dropping a PDF, the Draw/Type/Upload mode buttons, Clear, "Add to page", page Prev/Next, and "Export signed PDF" are all reachable via Tab and are plain `<button>`s — fully keyboard-operable. A keyboard-only user **can** get a signature or text field created and placed onto the page via this path (e.g. Type mode → type text → Tab to "Add to page" → Enter).

### Finding — not fixed: placed elements can't be moved or resized without a mouse

Once an element is placed, `SignPdf.svelte` positions and resizes it purely through pointer events:
```js
onpointerdown={(e) => onElementPointerDown(e, el)}          // drag to move
onpointerdown={(e) => onElementPointerDown(e, el, true)}    // resize handle (a <button aria-label="Resize">, but still pointer-only)
```
There is no `onkeydown` anywhere in this flow — no arrow-key nudge for position, no keyboard-accessible resize. So while *placing* a signature/text field is keyboard-operable, *repositioning or resizing* it afterward is not: a keyboard-only user is stuck with wherever the element landed at its default position/size. This is a genuine WCAG 2.1.1 (Keyboard) gap in the tool's core interaction.

**Not fixed here**: this needs real feature work (arrow-key move with a sensible step, e.g. Shift+Arrow for resize) rather than a small, safe change, and the task's own guidance says non-trivial fixes should be documented rather than attempted mid-audit. Recommended follow-up: add `tabindex="0"` plus an `onkeydown` handler to each placed-element wrapper (`role="group"` with an `aria-label` like "Signature, page 1 — use arrow keys to move, Shift+arrow to resize") in `src/tools/sign-pdf/SignPdf.svelte`.

## Fixes applied during this pass (recap)

| Fix | File | Verified |
|---|---|---|
| Restore visible focus indicator on all range sliders | `src/design/primitives/SteppedSlider.svelte` | Rule present in built CSS; sliders remain keyboard-operable (ArrowRight changes value) |

## Not fixed (documented findings)

| Finding | Location | Why not fixed here |
|---|---|---|
| Placed signature/text elements can only be moved/resized with a mouse | `src/tools/sign-pdf/SignPdf.svelte` (`onElementPointerDown`, `.resize-handle`) | Real feature work (arrow-key move/resize), not a small safe change |
| Quality-level buttons are a plain button row, not an ARIA radio-group with arrow-key switching | `src/tools/pdf-compressor/PdfCompressor.svelte` | Already fully keyboard-operable via Tab/Enter; a semantics upgrade, not a defect |
