# Interface guide

The JSON files in `docs/abi/` are compiler-generated ABI arrays, including events and custom errors. Both constructors are nonpayable. `LaunchToken()` takes no arguments; `SavingsCircle(address token_)` takes only the deployed CIRC address. Every mutating application method is nonpayable; no initialization call exists.

| Method | Meaning |
| --- | --- |
| `token() -> address` | Immutable working CIRC token |
| `circleCount() -> uint256` | Count of circles; valid IDs are `[0, circleCount)` |
| `create(uint256 contribution, uint256 roundLength, uint256 seats) -> uint256 id` | Pulls creator's bond and allocates seat zero |
| `join(uint256 id)` | Pulls bond and allocates the next free seat |
| `cancel(uint256 id)` | Permissionlessly credits bonds when recruitment expires unfilled |
| `contribute(uint256 id)` | Pulls one contribution for the time-derived round |
| `closeRound(uint256 id, uint256 round)` | Closes the next ended round; last closure also finalizes |
| `withdraw()` | Transfers all caller's accumulated credits to caller |
| `withdrawable(address) -> uint256` | Credits ready to collect, aggregated across circles |
| `circle(uint256 id) -> Circle` | Snapshot tuple described below |
| `member(uint256 id, uint256 seat) -> address` | Joined seat owner; requires `seat < joined` |
| `inDefault(uint256 id, address account) -> bool` | Any completed window was missed; false for nonmembers, recruiting or cancelled circles |
| `currentRound(uint256 id) -> uint256` | Zero while recruiting/cancelled; active window index; `seats` after all windows end |
| `paidRounds(uint256 id, address account) -> uint256` | Permanent bitmap: bit `r` is one iff the member paid round `r`; nonmembers return zero |
| `roundPot(uint256 id, uint256 round) -> uint256` | Unclosed round's contributions, excluding carry; zero after closure; requires `round < seats` |
| `accountedBalance() -> uint256` | Sum of all four global liability counters |
| `totalBonds()`, `totalOpenPots()`, `totalCarry()`, `totalWithdrawable()` | Global CIRC minor-unit liabilities |

All views taking a circle ID revert `UnknownCircle()` for a nonexistent ID, including `paidRounds` and `inDefault`. `currentRound` is a time value, **not** the round to close: call `closeRound(id, circle(id).nextRound)` when that round's deadline has passed. Once finalized `currentRound` is `seats`. Before activation `start` is zero and has no schedule meaning. Determine lifecycle from `state`, since an active circle may itself start at timestamp zero in a test chain.

`Circle` tuple order (all fields are `uint256` except `state`, ABI-encoded `uint8`):

| Index | Field | Interpretation |
| --- | --- | --- |
| 0 | `contribution` | CIRC minor units per round |
| 1 | `roundLength` | Seconds per round |
| 2 | `seats` | Required membership and round count |
| 3 | `joined` | Assigned seats |
| 4 | `createdAt` | Recruitment start timestamp |
| 5 | `start` | Activation timestamp, meaningful after activation |
| 6 | `nextRound` | Next round to close; equals `seats` after finalization |
| 7 | `bondsHeld` | Unsettled bonds |
| 8 | `openPots` | Sum of contributions in all unclosed rounds |
| 9 | `carry` | Pot carried from already-closed rounds |
| 10 | `state` | `0 Recruiting`, `1 Active`, `2 Cancelled`, `3 Finalized` |

`MIN_CONTRIBUTION = 10^18`, `MIN_ROUND_LENGTH = 3600`, `MAX_ROUND_LENGTH = 2592000` and `JOIN_PERIOD = 604800` have public getters. Read token `decimals()` to format amounts. `paidRounds & (1 << r)` lets the page distinguish "paid this round" from "not yet due" and "default".

| Event | Indexed fields | Other fields / interpretation |
| --- | --- | --- |
| `Created` | `id`, `creator` | `contribution`, `roundLength`, `seats`; followed by creator's `Joined` |
| `Joined` | `id`, `member` | `seat`; final join establishes `circle.start` |
| `Cancelled` | `id` | Bond credits are now withdrawable |
| `Contributed` | `id`, `round`, `member` | Exactly one round contribution accepted |
| `RoundClosed` | `id`, `round`, `recipient` | `pot`, `carried`; pot includes incoming carry, recipient is zero iff carried |
| `Finalized` | `id` | Final bond/distribution credits are ready; follows last `RoundClosed` |
| `Withdrawn` | `member` | `amount` actually collected |

Events describe successful transactions only. A round's eligible recipient may be shown even when `pot` is zero. A last-round carried pot is immediately included in final settlement; that event's `carried = true` does not imply carry remains stored after `Finalized`. Use current views as the source of truth after reorgs or missed logs.

Application custom errors distinguish invalid bounds/token/ID/seat/round, incorrect lifecycle, recruitment expiry, premature cancellation, duplicate or absent membership, a closed contribution window, default, double contribution, wrong closure order, early closure, missing withdrawal credit and incorrect incoming transfer amount. Token allowance/balance errors and SafeERC20/ReentrancyGuard errors can also bubble up. An approval should cover only the intended bond or contribution; a successful approval alone does not reserve a seat or ensure a payment deadline will be met.
