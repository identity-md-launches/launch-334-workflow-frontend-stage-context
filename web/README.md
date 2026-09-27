# Circle frontend

A single static page for the deployed CIRC SavingsCircle on Sepolia. Source lives here; the complete production export is `../dist/`. No backend, indexer, wallet key, RPC credential, external font or WalletConnect project ID is required.

## Install, build and preview

Use Node 22.12+ (worker used Node 24.21.0), npm, and Git with the deployed source commit available locally.

```sh
cd web
npm ci --cache /tmp/circle-npm-cache
npm run typecheck
npm run build
npm run verify:export
npm run preview
```

`npm run dev` first generates the same deployment configuration in the ignored `public/imd-deployment.json`. Production builds use Vite's relative base `./`, empty only `dist/`, copy ABI files and the favicon, then generate the final asset inventory. Do not edit the export by hand. Always rebuild and verify after changing source or public assets. Serve `dist/` over HTTP(S), including from a gateway directory; opening `file://` cannot fetch JSON.

`node scripts/serve.mjs` serves the production export at `http://127.0.0.1:4174/ipfs/circle/` for subpath testing. It is a local validation helper, not a hosting requirement.

## Deployment configuration and ABI provenance

`config/handoff.json` and `config/network.json` are verbatim copies of the assignment's pinned inputs. `public/abi/*.json` are raw ABI arrays copied using `git show <deployed-source-commit>:docs/abi/<Contract>.json`. `scripts/export.mjs` compares them with that exact Git commit and validates canonical Keccak-256 against every handoff ABI hash. Canonical JSON recursively sorts object keys, preserves array order, and has no insignificant whitespace. Hashes omit `0x`.

The build produces `dist/imd-deployment.json` with the exact launch, chain, deployed source commit, attestation, contract set, names, addresses and ABI hashes. It copies the supplied `network` and `walletAddChain` objects unchanged. Every other export file is inventoried with its final SHA-256. There are no runtime address or ABI maps compiled into the application: `src/config.ts` fetches this manifest and its ABI paths, verifies ABI hashes, then creates the chain/client from it. The copied build inputs are used only by the export script, never imported by application source.

The page reads `SavingsCircle.token()` and refuses writes if it differs from the attested token. It checks RPC chain ID and nonempty code for both contracts before displaying a verified snapshot and again before simulation. This is binding and presence verification, not a claim that the app independently reproduces the deployment attestation signature or proves runtime bytecode equivalence.

No router, quoter or Permit2 is used: the approved workflow explicitly requires **no in-page swap**. The unmodified network block still includes the vetted Uniswap v4 addresses. CIRC acquisition is explained on the page. The application approval spender is SavingsCircle, because it pulls bonds and contributions itself.

## Wallet and contract behavior

- Uses the injected EIP-1193 browser wallet (`window.ethereum`). No credentialed WalletConnect connector or wallet discovery chooser is configured. With multiple extensions, the wallet injected by the browser is used.
- Requests accounts only when Connect wallet is selected. Shows missing-wallet, rejection, wrong-chain, busy, submitted, confirmed and failed states. Listens for account, chain and disconnection events.
- Network switching uses the handoff's chain ID. Error 4902 or an unknown-chain message offers `wallet_addEthereumChain` using the exact supplied parameters, then switches again. Rejection is shown without automatically adding another chain.
- Public RPCs are tried in the supplied order with the connected wallet as a final read fallback only on the correct chain. Signing always stays in the wallet.
- Reads are pinned to one latest block per snapshot, refresh every 20 seconds, and show block/time. Reads include CIRC balance/decimals/allowance, withdrawable credit, circle count, paginated circles (six per page), selected seats/default/payment status, current/next round pots, bonds and carry. Direct ID lookup supports any existing circle.
- Create, join and contribute each show an explicit approval step before payment. Approval sets exactly the required amount; an existing sufficient allowance is marked Approved. It never requests an unlimited allowance. Insufficient balances, invalid inputs and lifecycle/membership/default/deadline constraints disable payment.
- Create accepts 1–720 whole hours (a UI subset of the contract's second-granularity range), 2–10 seats and at least 1 CIRC. Decimal inputs are validated before parsing; excess precision is rejected, not rounded.
- Close round targets `nextRound`, not the time-derived current round. Cancel is available at the exact seven-day boundary. Withdraw collects all caller-owned credit. These actions need no token approval.
- Simulates every transaction before signing, rechecks wallet account/chain after simulation, displays revert reasons, tracks the receipt and refreshes after success/failure. Writes are blocked during reads, while another request is pending, on wrong chain, or without a fresh snapshot. Stale snapshots expire after 60 seconds. A pending receipt timeout keeps its explorer link and tells the visitor to check it before retrying.

Display seats/rounds are numbered from 1; circle IDs and encoded round indices are unchanged zero-based contract values. Date/time is shown in the visitor's local timezone. Amounts retain the token's full decimal precision.

## Validation

```sh
cd web
npx playwright install chromium
npm test
```

`CHROMIUM_PATH` can select an existing Chromium executable. On this worker the shell thread quota required the following invocation from the repository root, with a fresh browser per test:

```sh
CI_LOW_THREADS=1 UV_THREADPOOL_SIZE=1 \
CHROMIUM_PATH=/home/imd/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell \
node --v8-pool-size=1 web/node_modules/@playwright/test/cli.js test -c web/playwright.config.ts
```

The production export is served with Python 3's static HTTP server for tests. The suite injects a mock wallet, decodes real ABI calldata, returns ABI-encoded RPC results, and records which transactions would be signed. It never broadcasts. It covers primary actions, approval order/amounts, network adding, eligibility, exact cancellation/closure boundaries, rejected requests, reverts, configuration failure and responsive/accessibility checks. Evidence and honest limits are in `../docs/FRONTEND_VALIDATION.md` and `../docs/frontend/`.

For read-only chain verification, `node scripts/scan.mjs` uses the first configured public RPC. An optional `--rpc <endpoint>` can select an operator-supplied temporary endpoint; no endpoint or credentials are written into the result. The script retains the handoff's deployment-block pin and records observed block hashes, code sizes and key views in `../docs/frontend/live-chain.json`.

The publication service, not this worker, pins and hosts the export. No publishing, contract changes, real swaps or live transactions were performed.

## Scope and packaging

Only `web/`, `dist/`, and `docs/` are delivered. The single allowed ignore file is `web/.gitignore`, with an explicit budget of one file under 1 KiB; it excludes dependency/cache and test-output directories at every depth under `web/`. No root ignore/configuration file is changed. Generated packages, registries and archives are excluded. The design document is `../docs/DESIGN.md`: the assignment's overriding write allowlist prohibits the otherwise requested root `DESIGN.md`.
