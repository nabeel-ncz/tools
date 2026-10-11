import { test, expect, type Page } from '@playwright/test';

// Tic Tac Toe:
//
//   1. Pass & play on one device — needs no server, runs against any build.
//   2. Online play between two independent browser contexts, against a REAL
//      local signaling server (`wrangler dev --local` in workers/filedrop on
//      ws://localhost:8787), with the site built with PUBLIC_SIGNALING_URL
//      pointed at it via `.env.local` — same setup as file-drop-and-pwa.
//
// Run with e.g.:
//   BASE_URL=http://127.0.0.1:4321 npx playwright test tic-tac-toe

const cell = (page: Page, i: number) => page.locator('.board .cell').nth(i);

test.describe('Tic Tac Toe — pass & play', () => {
  test('alternates turns, detects a win, keeps score and alternates the starter', async ({ page }) => {
    await page.goto('/tic-tac-toe');
    await page.getByRole('button', { name: 'Play on this device' }).click();

    await expect(page.locator('.status')).toHaveText('X to play');
    // X: 0, 1, 2 (top row) — O: 3, 4
    for (const i of [0, 3, 1, 4, 2]) await cell(page, i).click();

    await expect(page.locator('.status')).toHaveText('X wins!');
    await expect(page.locator('.cell.win')).toHaveCount(3);
    await expect(page.locator('.score-value').first()).toHaveText('1');

    // The board is frozen once the round is over.
    await cell(page, 8).click({ force: true });
    await expect(cell(page, 8)).toHaveAttribute('aria-label', /empty/);

    await page.getByRole('button', { name: 'Play again' }).click();
    await expect(page.locator('.status')).toHaveText('O to play');
    await expect(page.locator('.board .cell svg')).toHaveCount(0);
  });

  test('cells are keyboard playable with arrow keys', async ({ page }) => {
    await page.goto('/tic-tac-toe');
    await page.getByRole('button', { name: 'Play on this device' }).click();
    await cell(page, 0).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(cell(page, 4)).toHaveAttribute('aria-label', 'Row 2, column 2: X');
  });
});

test.describe('Tic Tac Toe — online over local signaling', () => {
  test('two browser contexts pair by link and play a full game peer-to-peer', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    // Moves must travel over the data channel, never the signaling socket.
    const signalingFrames: string[] = [];
    for (const page of [pageA, pageB]) {
      page.on('websocket', (ws) => {
        if (!ws.url().includes('/ws/tictactoe/')) return;
        ws.on('framesent', (frame) => signalingFrames.push(String(frame.payload)));
      });
    }

    await pageA.goto('/tic-tac-toe');
    await pageA.getByRole('button', { name: 'Start a game' }).click();
    const code = (await pageA.locator('.pairing-details .code').textContent())?.trim() ?? '';
    expect(code).toMatch(/^[A-Z0-9]{6}$/);

    await pageB.goto(`/tic-tac-toe?join=${code}`);
    for (const page of [pageA, pageB]) {
      await expect(page.locator('.led')).toHaveClass(/led-live/, { timeout: 20_000 });
    }

    await expect(pageA.locator('.status')).toHaveText("Your turn — you're X");
    await expect(pageB.locator('.status')).toHaveText('Waiting for X…');

    // O can't move out of turn.
    await cell(pageB, 4).click({ force: true });
    await expect(cell(pageA, 4)).toHaveAttribute('aria-label', /empty/);

    // X: 0, 4, 8 (diagonal) — O: 1, 2
    const moves: [Page, number][] = [
      [pageA, 0],
      [pageB, 1],
      [pageA, 4],
      [pageB, 2],
      [pageA, 8],
    ];
    for (const [page, i] of moves) {
      await cell(page, i).click();
      const other = page === pageA ? pageB : pageA;
      await expect(cell(other, i)).not.toHaveAttribute('aria-label', /empty/);
    }

    await expect(pageA.locator('.status')).toHaveText('You win!');
    await expect(pageB.locator('.status')).toHaveText('You lose.');

    // Rematch from the loser's side: O starts round two on both devices.
    await pageB.getByRole('button', { name: 'Play again' }).click();
    await expect(pageB.locator('.status')).toHaveText("Your turn — you're O");
    await expect(pageA.locator('.status')).toHaveText('Waiting for O…');
    await expect(pageA.locator('.board .cell svg')).toHaveCount(0);

    // Leaving tells the other player.
    await pageB.getByRole('button', { name: 'Leave game' }).click();
    await expect(pageA.locator('.notice.error')).toHaveText(/opponent left/i);

    for (const raw of signalingFrames) {
      const msg = JSON.parse(raw);
      expect(['sdp', 'ice']).toContain(msg.kind);
    }

    await ctxA.close();
    await ctxB.close();
  });
});
