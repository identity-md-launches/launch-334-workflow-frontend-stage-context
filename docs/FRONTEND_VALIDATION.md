# Frontend validation

Worker date: 2026-09-27. This is worker-produced evidence, not an independent behavior or security certification. Contract source and root build configuration were preserved. The deployed source pin remains `232defab803dc69173ea1f3007bd624adc259247`.

## Delivered scope

Vite/React/TypeScript source, package/lockfile, frontend build and test configuration are under `web/`. The ready-to-serve static page, local bundles, favicon, both raw ABIs and runtime manifest are under `dist/`. Documentation and selected evidence are under `docs/`. The sole new ignore file is `web/.gitignore` (explicit path budget: one file, maximum 1 KiB; actual 261 bytes). It excludes generated dependencies and caches at all nested levels within `web/`.

The approved workflow expressly says “no in-page swap.” This takes precedence over the generic swap reference. The UI explains acquisition through the Sepolia ETH launch pool; no swap, quote, router approval or liquidity control is added. The required network object, including all vetted Uniswap addresses, is preserved in the runtime manifest. SavingsCircle payments approve SavingsCircle as their spender.

The request for root `DESIGN.md` conflicts with the overriding path allowlist. Its complete contents are delivered as `docs/DESIGN.md`. No root file was changed to work around that restriction.

## Commands and outcomes

| Check | Result / evidence |
| --- | --- |
| `npm ci` / dependency installation | Normal npm dependencies with committed lockfile; cache kept in `/tmp`. Initial default-cache write failed because the home directory is read-only; retry with an explicit temporary cache succeeded. |
| `npm --prefix web run typecheck` | Pass. `docs/frontend/typecheck.txt`. |
| `npm --prefix web run build` | Pass. `docs/frontend/build.txt`. Relative base, no runtime CDN dependencies. Vite reports a non-fatal >500kB JS chunk advisory; the whole export remains below 1 MiB. |
| `npm --prefix web run verify:export` | Pass. `docs/frontend/export-check.txt`. Both pinned ABIs and every exported asset checked. |
| Playwright production interaction suite | 16 tests. Final run and timing: `docs/frontend/interaction-results.txt`. All signing requests are mocked. |
| Accessibility/rendering | Zero axe violations in the tested desktop and mobile states. Five widths, target heights, computed contrast, keyboard actions, RTL, increased text and reduced motion: `docs/frontend/browser-results.json`. |
| Live read-only Sepolia probe | Pass at deployment block 11791319 and latest observed block 11791563. `docs/frontend/live-chain.json` records hashes, code sizes, token binding, supply and circle count. |
| Real browser public-RPC load | The exported page loaded from the configured PublicNode RPC at desktop/mobile widths, then from `/ipfs/circle/`. Manifest/ABI URLs stayed under that subpath. Evidence: `docs/frontend/live-browser-state.json`, live screenshots, and browser network/console record. |
| Paths, dependency exclusion, export and bundle size | `docs/frontend/package-check.json` records the final check. Temporary browser artifacts outside the allowlist are removed before delivery. No Git submodules. |

Reproduction commands are in `web/README.md`. Shell-launched Chromium initially exhausted the worker's thread quota. Final tests use one fresh Chromium per test with `CI_LOW_THREADS=1`, `UV_THREADPOOL_SIZE=1` and Node `--v8-pool-size=1`; the test server uses Python static hosting. This changes the test process, not the shipped app. Browser fixtures decode actual submitted ABI calldata and encode contract view results, but do not execute EVM bytecode.

## Interaction coverage

The suite checks disconnected/missing-wallet behavior and connection rejection/retry; wrong-chain gating; unknown-chain add then switch with exact handoff parameters; rejected switching without adding a chain; account removal; exact bond approval followed by separate create/join transactions; existing allowance; contribution once per round; closeRound using the next unsettled zero-based index; exact cancellation and closure boundaries; withdrawing the full credit; default/nonmember/ended-window gating; insufficient balance; decimal precision and input range errors; simulation custom reverts; wallet transaction rejection; reverted receipt; missing code/wrong RPC chain; ABI tampering; RPC outage/recovery; paginated IDs and direct lookup including nonexistent IDs. No real transaction was signed or broadcast.

Snapshot reads are tied to one block. The UI displays the block/time, periodically refreshes, and disables transactions when snapshots are absent, stale, refreshing, or on the wrong wallet chain. Code/chain/token binding is checked again before simulation; account/chain is checked immediately before requesting a signature. This narrows stale-state races but cannot guarantee a transaction's mined outcome. A competing join or a crossed deadline can still cause a revert, and pending receipts must be inspected before retrying.

## Better Interface consolidated review

All six core domains and the workflow/documentation sections were read from the pinned references. Review scope included the full page, all primary contract controls, disconnected/connected/wrong-chain/error states and the selected-circle view. Findings below refer to final source locations; a fixed finding's earlier behavior is described explicitly.

| Domain | Coverage and observations | Findings / corrections |
| --- | --- | --- |
| Accessibility | Native buttons, labeled inputs/select, semantic headings/main/dl, live status and alert regions, native disclosure. Keyboard skip-to-main, field editing and disclosure activation exercised. Visible controls measured at least 44px high across tested widths. Axe on desktop/mobile. | `web/src/App.tsx:138`: main now has `tabIndex={-1}` so the skip target receives focus. `web/src/App.tsx:154` and `web/src/model.ts:44`: grouped validation originally marked both inputs invalid; now each error identifies only its field. Keyboard test setup initially retained prior pointer focus; reset to initial page navigation before testing Tab, then verified main focus. |
| Layout | Rendered at 1440, 960, 760, 390 and 320px; no horizontal overflow. Checked 390px RTL mirror and 200% root text. Read and action groups remain in normal flow. | No unresolved clipping found in tested states. Responsive row metadata wraps below at narrower widths; wallet/action groups wrap instead of hiding controls. See `web/src/styles.css:136`. |
| Writing | Source review of every action, prerequisite, unit, lifecycle and error. Explicit approval/payment distinction; full economic caveat reflects the supplied implementation review. | `web/src/model.ts:66`: generic viem short messages hid Solidity custom errors. Added decoded error names and recovery guidance; RoundNotEnded simulation test verifies the fix before any signing. |
| Typography | Descending heading sizes, platform fonts, tabular numbers, full-precision balances and wrapping inspected in desktop/mobile captures. Inputs are 16px. | No observed truncation/overlap at tested sizes. Platform font availability remains platform-dependent; no webfont-loading claim. |
| Colors | Computed real opaque foreground/background pairs, automated contrast checks and textual statuses. Specific measured ratios are in the browser JSON and design document. | Tested pairs exceed 4.5:1. The design intentionally has only a light theme; dark-theme testing is not applicable. No claim that every hover/focus/selection combination was measured. |
| UI details | Empty/loading/pending/disabled/selected/error states exercised. Restrained CSS feedback; reduced motion removes transitions. Local favicon and CSS brand mark. | `web/index.html:8`: initial browser console showed a missing favicon request. Added `web/public/favicon.svg`, rebuilt the export and verified no console/resource errors on reload. |

The final live empty-state screenshots are `docs/frontend/live-desktop.png` and `live-mobile.png`; mocked connected/detail screenshots are `desktop.png` and `mobile.png`. Mocked screenshots demonstrate rendering only, not the existence of live funded circles. The latest live read found zero circles.

## Remaining limits

- No funded wallet, actual approval/payment/withdrawal, pool quote, swap, mining delay/replacement or chain reorganization was tested. Mock receipts cannot prove live EVM behavior. The deployed contract's carry/all-default economic findings remain unresolved and are stated in the page. This frontend does not claim to fix them.
- Only Chromium on this worker was exercised. Native mobile wallets, Safari, Firefox, screen readers, touch hardware, browser chrome zoom, pseudo-localization and the animations panel at slowed speed were not tested. The 200% check increases root text size; it is not a native-device/browser-zoom claim. RTL was a mirror/layout check, not translated content.
- Wallet fallback transport is implemented; live reads were observed through the configured public RPC, not a live extension's RPC fallback. Multi-wallet chooser, WalletConnect and hardware-wallet-specific behavior are not implemented or claimed.
- ABI hashes and handoff field consistency are checked locally. Runtime code presence and token binding are checked; the browser does not independently validate the attestation signature or reconstruct creation bytecode. Publication's fixed-CID/named-entrypoint, asset, attestation and RPC checks run later and are not claimed here.
- `git add -- web dist docs` failed because `.git/index.lock` cannot be created on the read-only Git mount. Source/export/evidence remain in the permitted working-tree paths for the publisher. A temporary external Git snapshot is used only to measure a complete self-contained submission bundle; it does not change the protected repository's index or claim a working-tree commit succeeded.

Attribution and design-system reuse details are in `docs/DESIGN.md`.
