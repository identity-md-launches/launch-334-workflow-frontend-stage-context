import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseEther } from 'viem';
import { account, fixture, timestamp } from './fixtures';
import network from '../config/network.json' with { type: "json" };

const docs = fileURLToPath(new URL('../../docs/frontend/', import.meta.url));

// Launch a fresh browser per test; single-process Chromium cannot safely recycle contexts.
const test = base.extend({
  context: async ({ playwright, baseURL }, use) => {
    const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: process.env.CI_LOW_THREADS ? ['--single-process', '--no-zygote', '--disable-gpu'] : [] });
    const context = await browser.newContext({ baseURL });
    await use(context);
    await context.close();
    await browser.close();
  },
});

async function loaded(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByText('Live snapshot', { exact: false })).toBeVisible();
}
async function selectCircle(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /Circle #0/ }).click();
  await expect(page.getByRole('heading', { name: 'Circle #0' })).toBeVisible();
  await expect(page.getByText('Refreshing', { exact: true })).toHaveCount(0);
}

test('disconnected and missing wallet', async ({ page }) => {
  await fixture(page, { connected: false, wallet: false }); await loaded(page);
  await expect(page.getByRole('button', { name: '2. Open circle' })).toBeDisabled();
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('alert')).toContainText('No browser wallet found');
});

test('rejected connection can be retried', async ({ page }) => {
  await fixture(page, { connected: false }); await loaded(page);
  await page.evaluate(() => { (window as any).mockWallet.reject = true; });
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('alert')).toContainText('Request declined');
  await page.evaluate(() => { (window as any).mockWallet.reject = false; });
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible();
});

test('wrong chain offers add chain with the exact handoff parameters, then switches', async ({ page }) => {
  await fixture(page, { wrongChain: true }); await loaded(page);
  await expect(page.getByRole('button', { name: '1. Approve CIRC' })).toBeDisabled();
  await page.getByRole('button', { name: 'Switch to Sepolia' }).click();
  await expect(page.getByRole('button', { name: 'Switch to Sepolia' })).toHaveCount(0);
  const requests = await page.evaluate(() => (window as any).mockWallet.requests);
  expect(requests.filter((r: any) => r.method === 'wallet_switchEthereumChain')).toHaveLength(2);
  expect(requests.find((r: any) => r.method === 'wallet_addEthereumChain').params[0]).toEqual(network.walletAddChain);
  await expect(page.getByRole('button', { name: '1. Approve CIRC' })).toBeEnabled();
});

test('approve exact bond before create; refresh balances and show receipt', async ({ page }) => {
  const s = await fixture(page); await loaded(page);
  await expect(page.getByRole('button', { name: '2. Open circle' })).toBeDisabled();
  await page.getByRole('button', { name: '1. Approve CIRC' }).click();
  await expect(page.getByText('Approval confirmed.', { exact: false })).toBeVisible();
  expect(s.sent[0].functionName).toBe('approve'); expect(s.sent[0].args[1]).toBe(parseEther('30'));
  await expect(page.getByRole('button', { name: '2. Open circle' })).toBeEnabled();
  await page.getByRole('button', { name: '2. Open circle' }).click();
  await expect(page.getByText('Transaction confirmed.', { exact: false })).toBeVisible();
  expect(s.sent[1]).toEqual({ functionName: 'create', args: [parseEther('10'), 86400n, 4n] });
  await expect(page.getByRole('link', { name: /View transaction/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Circle #1/ })).toBeVisible();
});

test('join approves the exact bond and prevents duplicate membership', async ({ page }) => {
  const s = await fixture(page); await loaded(page); await selectCircle(page);
  const detail = page.locator('.detail-panel');
  await detail.getByRole('button', { name: '1. Approve CIRC' }).click();
  await expect(detail.getByRole('button', { name: '2. Join circle' })).toBeEnabled();
  await detail.getByRole('button', { name: '2. Join circle' }).click();
  await expect(page.getByText('You already have a seat.')).toBeVisible();
  expect(s.sent.map(x => x.functionName)).toEqual(['approve', 'join']);
  expect(s.sent[1].args).toEqual([0n]);
  await expect(detail.getByRole('button', { name: '2. Join circle' })).toBeDisabled();
});

test('contribute once, close the next ended round, and withdraw', async ({ page }) => {
  const s = await fixture(page, { state: { state: 1, joined: 4n, currentRound: 1n, paid: 1n, member: account, allowance: parseEther('10') } });
  await loaded(page); await selectCircle(page);
  await page.getByRole('button', { name: '2. Contribute' }).click();
  await expect(page.getByText('You have paid this round.')).toBeVisible();
  await expect(page.getByRole('button', { name: '2. Contribute' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close round 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close round 2', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Withdraw CIRC' })).toBeEnabled();
  await page.getByRole('button', { name: 'Withdraw CIRC' }).click();
  await expect(page.getByRole('button', { name: 'Withdraw CIRC' })).toBeDisabled();
  await expect.poll(() => s.sent.map(x => x.functionName)).toEqual(['contribute', 'closeRound', 'withdraw']);
  await expect(page.locator('.balances .stat').last().locator('dd')).toHaveText('0CIRC');
  expect(s.sent[1].args).toEqual([0n, 0n]);
});

test('expired recruitment permits cancellation and blocks joining at the exact boundary', async ({ page }) => {
  const s = await fixture(page, { state: { createdAt: timestamp - 604800n } });
  await loaded(page); await selectCircle(page);
  await expect(page.getByRole('button', { name: '2. Join circle' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel unfilled circle' }).click();
  await expect(page.getByText('This circle is settled.', { exact: false })).toBeVisible();
  expect(s.sent.map(x => x.functionName)).toEqual(['cancel']);
});

test('default, nonmember, early closure and ended windows prevent contribution', async ({ page }) => {
  const s = await fixture(page, { state: { state: 1, member: account, inDefault: true, start: timestamp, currentRound: 0n, allowance: parseEther('100') } });
  await loaded(page); await selectCircle(page);
  await expect(page.getByRole('button', { name: '2. Contribute' })).toBeDisabled();
  await expect(page.getByText('You missed a round', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close round 1', exact: true })).toBeDisabled();
  s.inDefault = false; s.member = '0x3000000000000000000000000000000000000003';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('Only members can contribute.')).toBeVisible();
  s.member = account; s.currentRound = 4n;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('All contribution windows have ended.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '2. Contribute' })).toBeDisabled();
  expect(s.sent).toHaveLength(0);
});

test('simulation revert, wallet rejection and reverted receipt remain actionable errors', async ({ page }) => {
  const s = await fixture(page, { state: { allowance: parseEther('30'), simulationError: true } }); await loaded(page);
  await page.getByRole('button', { name: '2. Open circle' }).click();
  await expect(page.getByRole('alert')).toContainText('RoundNotEnded'); expect(s.sent).toHaveLength(0);
  s.simulationError = false;
  await page.evaluate(() => { (window as any).mockWallet.reject = true; });
  await expect(page.getByRole('button', { name: '2. Open circle' })).toBeEnabled();
  await page.getByRole('button', { name: '2. Open circle' }).click();
  await expect(page.getByRole('alert')).toContainText('Request declined'); expect(s.sent).toHaveLength(0);
  await page.evaluate(() => { (window as any).mockWallet.reject = false; });
  s.receiptFailed = true;
  await expect(page.getByRole('button', { name: '2. Open circle' })).toBeEnabled();
  await page.getByRole('button', { name: '2. Open circle' }).click();
  await expect(page.getByRole('alert')).toContainText('reverted on-chain');
});

test('amount precision, balance and account/network changes block unsafe writes', async ({ page }) => {
  const s = await fixture(page, { state: { balance: parseEther('2') } }); await loaded(page);
  await expect(page.getByRole('button', { name: '1. Approve CIRC' })).toBeDisabled();
  await page.getByLabel('Contribution per round').fill('1.0000000000000000001');
  await expect(page.locator('#create-error')).toContainText('at most 18 decimal places');
  await page.getByLabel('Contribution per round').fill('0.5');
  await expect(page.locator('#create-error')).toContainText('at least 1 CIRC');
  await page.getByLabel('Contribution per round').fill('1'); await page.getByLabel('Round length').fill('721');
  await expect(page.locator('#create-error')).toContainText('1 to 720 hours');
  await page.getByLabel('Round length').fill('24');
  await page.evaluate(() => { const w = (window as any).mockWallet; w.chain = '0x1'; w.listeners.chainChanged.forEach((fn: any) => fn('0x1')); });
  await expect(page.getByRole('button', { name: 'Switch to Sepolia' })).toBeVisible();
  expect(s.sent).toHaveLength(0);
});

test('fail closed on absent contract code or an RPC chain mismatch', async ({ page }) => {
  const s = await fixture(page, { state: { missingCode: true } }); await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('contract code is missing');
  await expect(page.getByRole('button', { name: '1. Approve CIRC' })).toBeDisabled();
  s.missingCode = false; s.readChain = 1;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('wrong network');
});

test('ABI tampering blocks deployment loading', async ({ page }) => {
  await fixture(page);
  await page.route('**/abi/SavingsCircle.json', route => route.fulfill({ json: [] }));
  await page.goto('/'); await expect(page.getByRole('alert')).toContainText('ABI verification failed');
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '1. Approve CIRC' })).toBeDisabled();
});

test('pagination and direct circle lookup use contract IDs', async ({ page }) => {
  await fixture(page, { state: { count: 8n } }); await loaded(page);
  await expect(page.getByRole('button', { name: /Circle #5/ })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('button', { name: /Circle #6/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.getByLabel('Circle ID', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Find circle', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Circle #2' })).toBeVisible();
  await page.getByLabel('Circle ID', { exact: true }).fill('8');
  await page.getByRole('button', { name: 'Find circle', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('existing circle ID');
});

test('RPC outage disables writes and refresh recovers the empty state', async ({ page }) => {
  const s = await fixture(page, { wallet: false, state: { rpcFail: true, count: 0n } });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Live state unavailable');
  await expect(page.getByRole('button', { name: '1. Approve CIRC' })).toBeDisabled();
  s.rpcFail = false;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The first circle starts with you.' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('rejected network switch does not add a chain and account removal disables writes', async ({ page }) => {
  await fixture(page, { wrongChain: true }); await loaded(page);
  await page.evaluate(() => { (window as any).mockWallet.rejectSwitch = true; });
  await page.getByRole('button', { name: 'Switch to Sepolia' }).click();
  await expect(page.getByRole('alert')).toContainText('Request declined');
  expect(await page.evaluate(() => (window as any).mockWallet.requests.filter((r: any) => r.method === 'wallet_addEthereumChain'))).toEqual([]);
  await page.evaluate(() => { const w = (window as any).mockWallet; w.connected = false; w.listeners.accountsChanged.forEach((fn: any) => fn([])); });
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
  await expect(page.getByRole('button', { name: '1. Approve CIRC' })).toBeDisabled();
});

test('desktop/mobile accessibility, keyboard, layout, contrast and screenshots', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', e => failures.push(e.message));
  page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  await fixture(page, { state: { state: 1, joined: 4n, member: account, paid: 1n, currentRound: 1n, allowance: parseEther('10') } });
  await page.setViewportSize({ width: 1440, height: 1000 }); await loaded(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await selectCircle(page);
  await mkdir(docs, { recursive: true });
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({ path: docs + 'desktop.png', fullPage: true });
  const layouts: unknown[] = [];
  for (const width of [1440, 960, 760, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, controls: [...document.querySelectorAll('button,input,select,summary')].filter(el => el.getClientRects().length).map(el => ({ text: el.textContent?.slice(0, 35), height: el.getBoundingClientRect().height })) }));
    expect(measured.scrollWidth).toBeLessThanOrEqual(width); expect(measured.controls.every(c => c.height >= 44)).toBeTruthy(); layouts.push(measured);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: docs + 'mobile.png', fullPage: true });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  await page.getByLabel('Contribution per round').focus(); await page.keyboard.press('Control+A'); await page.keyboard.type('20');
  await expect(page.getByLabel('Contribution per round')).toHaveValue('20');
  await page.getByText('Understand the commitments', { exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.rules')).toHaveAttribute('open', '');
  const contrast = await page.evaluate(() => {
    const channel = (v: number) => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    const lum = (s: string) => { const c = s.match(/[\d.]+/g)!.map(Number); return .2126 * channel(c[0]) + .7152 * channel(c[1]) + .0722 * channel(c[2]); };
    const bg = (e: Element): string => { const c = getComputedStyle(e).backgroundColor; return c === 'rgba(0, 0, 0, 0)' ? e.parentElement ? bg(e.parentElement) : 'rgb(255, 255, 255)' : c; };
    return ['.lede', '.notice p', '.stat dt', '.badge', '.payment button:not(:disabled)', 'h1', '.rules p'].map(selector => { const el = document.querySelector(selector)!; const foreground = getComputedStyle(el).color, background = bg(el); const a = lum(foreground), b = lum(background); return { selector, foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }; });
  });
  expect(contrast.every(c => c.ratio >= 4.5)).toBeTruthy();
  await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.evaluate(() => { document.documentElement.dir = 'ltr'; document.documentElement.style.fontSize = '32px'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('button').first().evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  expect(failures).toEqual([]);
  await writeFile(docs + 'browser-results.json', JSON.stringify({ automatedAxeViolations: audit.violations, widths: layouts, contrast, resourceAndPageErrors: failures, checks: ['keyboard skip link, field editing and disclosure', 'RTL mirror at 390px', '200% root text at 390px', 'reduced motion'] }, null, 2) + '\n');
});
