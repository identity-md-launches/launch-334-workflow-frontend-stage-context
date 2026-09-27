# Circle contracts

Circle (CIRC) and SavingsCircle implement the approved rotating savings circle workflow for Sepolia (chain ID **11155111**). This contribution contains contract source, vendored dependencies, tests, ABI exports and the deployment handoff. Source publication, the independently reviewed `launch.json`, attestations, admission, deployment and the live website are subsequent service/contributor responsibilities.

**Economic requirement conflict:** the specified settlement rules do not universally make default after payout unprofitable. Both accumulated carry and the all-default fallback produce concrete counterexamples. The implementation follows the explicit payout and bond rules; [the review handoff](docs/REVIEW.md) records reproductions and the narrower guarantee that does hold. An independent adversarial reviewer must assess these findings before release. These tests are not an independent audit.

## Reproduce locally

Foundry and Solidity **0.8.26** are required. All Solidity dependencies are ordinary files in `lib/`; builds need no package installation or network once the pinned compiler is installed. Compiler configuration uses optimizer runs 200, Cancun EVM and `bytecode_hash = "none"`. FFI and filesystem permissions are not enabled. Tests do not read or change environment variables, broadcast, or depend on shared state.

```sh
forge build
forge test
forge fmt --check
```

The tests exercise token behavior, parameter/seat limits, allowance failures, exact deadlines, delayed and out-of-order closing, duplicate actions, default and carry, final splits including remainder, nobody contributing, concurrent circles, safe token transfers, withdrawal failure and reentrancy. A fuzzed independent settlement model checks payment prefixes. A stateful invariant tracks custody, independently recorded deposits/withdrawals, all liability categories and eventual recovery after arbitrary operation sequences. The economic tests cover every seat for 2–10 members when all other members stay good, plus both specification counterexamples.

## Deployment parameters

| Order | Source / contract | Constructor | Initial funding / authority |
| --- | --- | --- | --- |
| Token | `src/LaunchToken.sol:LaunchToken` | No arguments | Mints exactly `1000000000000000000000000000` minor units to the deploying factory |
| Application | `src/SavingsCircle.sol:SavingsCircle` | One `address token_`, manifest reference `["$token"]` | Zero CIRC and ETH required; no privileged role |

LaunchToken is named **Circle**, symbol **CIRC**, with 18 decimals and 1,000,000,000 tokens. Its only mint occurs in its nonpayable constructor; it exposes standard ERC-20 transfers and approvals with no mint, owner, pause, blocklist, fee or upgrade functions. SavingsCircle stores the token immutably, rejects a zero/noncontract address, and does not touch the supply during construction. The factory must pass the actual accepted LaunchToken address: code existence alone cannot authenticate a token. Constructors do not assign authority to `msg.sender`, call initialization hooks or require funded application balances.

The separate manifest assignment should identify `LaunchToken` as the launch token and `SavingsCircle` as the sole application, with kind `evm_project`. Policy values, pool setup, project owner policy and signed artifact linkage belong to launch services. This implementation has no owner argument. Services must enforce Sepolia deployment and verify the accepted compiler/settings, source and constructor argument against the manifest and resulting runtime. The contracts do not themselves reject other chain IDs.

The factory distributes CIRC to the launch pool and protocol rewards; participants obtain CIRC by swapping Sepolia ETH in the launch pool. No service or application balance needs to be seeded separately. No private key, funded wallet or deployment transaction is needed to run this repository's tests.

## Circle operation

All amounts are integer CIRC minor units (`1 CIRC = 10^18`); Solidity's `ether` literal in source denotes that scale, never ETH payments.

1. Approve SavingsCircle to spend the bond, then call `create(contribution, roundLength, seats)`. Contribution is at least 1 CIRC, round length is 1 hour through 30 days inclusive, and seats are 2 through 10 inclusive. The creator takes seat zero and pays `(seats - 1) * contribution`. IDs start at zero. The bond multiplication must fit `uint256`, and transfers must be funded.
2. Each distinct member approves the same bond and calls `join(id)` for the next seat. No seat transfer, duplicate seat, early departure or manual activation exists. Joining is permitted strictly before `createdAt + 7 days`. The final join starts round zero at that block's timestamp. At the exact seven-day deadline an unfilled circle can no longer accept members; anyone can `cancel(id)`, immediately crediting every joined member's entire bond.
3. Round `r` has the fixed half-open window `[start + r * roundLength, start + (r + 1) * roundLength)`. Each member approves and calls `contribute(id)` once per window. The method derives the round from time. It cannot backfill an earlier payment. Missing any completed window permanently bars further contributions and forfeits later payout turns. Bonds never substitute for payments.
4. At or after each end timestamp anyone may `closeRound(id, r)`. Rounds must close in order. Closing cannot move the schedule: later-round contributions are allowed while prior rounds await closure. The round's seat receives its contributions plus carry only if that member paid **all rounds 0 through r**. Later defaults do not retrospectively revoke earned payouts, including when closure is delayed. Otherwise the whole pot carries forward. There is no randomness.
5. Closing the last round also finalizes. Members who paid every round recover their bonds. Final carry and all forfeited bonds are split among these good members. If no good member remains, the pool is split among everyone who contributed at least once. The entire remainder in minor units goes to the lowest eligible seat. If nobody ever contributed, all members recover their bonds. A fully subscribed circle cannot be cancelled; late closure remains available indefinitely.
6. All payouts, refunds and distributions create `withdrawable(account)` credits. The recipient calls `withdraw()` to collect all their credits across every circle to their own address. Effects precede the transfer and all mutating entrypoints are nonReentrant. A failed transfer restores the credit and does not block settlement or other recipients. There is no withdrawal deadline or third-party destination parameter.

## Accounting and trust

For CIRC sent through the application entrypoints:

```text
token.balanceOf(SavingsCircle)
  = totalBonds + totalOpenPots + totalCarry + totalWithdrawable
```

`circle(id)` also exposes its local bonds, open pots and carry. A round close moves its pot into either carry or credits, cancellation moves bonds into credits, finalization clears bonds and carry into credits, and withdrawal removes the same amount from custody and credits. All circle loops have at most ten members. An incoming transfer must increase custody by exactly the requested amount; failure rolls back every associated state change.

The working asset must be the immutable, fixed-supply, non-rebasing, fee-free CIRC. A malicious/rebasing replacement token is outside this deployment assumption. Anyone can transfer ERC-20 tokens directly to the application address, so unsolicited CIRC creates unassigned surplus (`balance >= accountedBalance`), not a credit. There is no sweep/admin rescue. Other tokens sent here are also unrecoverable. No payable function, receive or fallback exists; normal ETH transfers revert. EVM-forced ETH can still arrive without calling a function and would be stuck; it is never used in accounting.

There is no admin, pause, upgrade, privileged beneficiary, external oracle, keeper dependency or emergency withdrawal. Members must monitor deadlines and submit timely payments. Anyone can close/cancel eligible circles; members themselves must claim credits. Chain congestion and abandoned private keys do not relax deadlines. Independent review must consider these irreversible rules and the economic conflicts before deployment.

## Frontend handoff

ABI arrays are in [docs/abi/LaunchToken.json](docs/abi/LaunchToken.json) and [docs/abi/SavingsCircle.json](docs/abi/SavingsCircle.json); [the interface guide](docs/ABI.md) defines tuple fields, event semantics and time sentinels. Regenerate them with:

```sh
forge inspect src/LaunchToken.sol:LaunchToken abi --json > docs/abi/LaunchToken.json
forge inspect src/SavingsCircle.sol:SavingsCircle abi --json > docs/abi/SavingsCircle.json
```

After services publish the accepted live addresses and deployment block, the frontend assignment builds the small `lab-savings-circle` page and exports `dist/index.html`. It should use `token()` to discover CIRC, show the connected wallet's balance/allowance/withdrawable credit, offer approval before create/join/contribute, and expose withdrawal. Lists can enumerate `0..circleCount()-1`, load `circle(id)` and seats, and use events via RPC to refresh; no backend or indexer is needed. Display each schedule/deadline, current seat, pot plus carry and `inDefault` status. Explain the external launch-pool swap route, with no in-page swap. Deployment, independent review, GitHub publication and IPFS hosting are later authorized workflow steps, not actions performed by this source contribution.
