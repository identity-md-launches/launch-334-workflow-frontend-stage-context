# Implementation review handoff

This is the source author's analysis and executable evidence for the separate independent reviewer. It is not an independent security review or a deployment approval. The manifest and signed artifacts are produced/reviewed later; source and argument conflicts below remain findings even if deployment baseline checks pass.

## Economic conflict 1: all-default fallback can reward a paid defaulter

The approved workflow requires both a `(seats - 1) * contribution` bond that makes default after payout unprofitable and distribution of all forfeited bonds to prior contributors when no good members remain. Those requirements conflict.

Reproduction: `test_specificationCounterexampleAllDefaultFallbackCanProfitEarlyRecipient` in `test/SavingsCircleModel.t.sol`.

For two seats and a contribution of 1 CIRC, both members deposit 1 CIRC bonds and contribute in round zero. Seat zero withdraws the 2 CIRC pot. Both miss round one. Finalization must distribute the 2 CIRC forfeited bonds equally to the two prior contributors. Seat zero finishes with 3 CIRC received, having deposited only 2 CIRC: a **1 CIRC profit despite default after payout**. Seat one loses 1 CIRC. All accounting remains conserved.

## Economic conflict 2: carry can exceed a later recipient's bond protection

Reproduction: `test_specificationCounterexampleCarryCanProfitDefaulterWithGoodMembers` in the same file.

For four seats and contribution 1 CIRC, each bond is 3 CIRC. Seat zero never contributes. Seats one, two and three pay round zero, whose 3 CIRC pot carries. All three also pay round one, so seat one collects 6 CIRC. Seat one then defaults; seats two and three complete every round. Seat one forfeits its full bond and receives no final distribution, yet its total outlay was only 3 CIRC bond plus 2 CIRC contributions: it still profits **1 CIRC**. Thus restricting the all-default fallback alone would not resolve the claimed economic guarantee.

## Guarantee actually demonstrated

When every other member stays in good standing and there is no incoming carry, the bond bounds a sole defaulter's gain. For `n` seats, seat `r` paying through its turn receives at most `n * c`, pays `(r + 1) * c`, and loses bond `(n - 1) * c` if it defaults later. Net gain is at most `-r * c`, which is nonpositive. The final seat cannot default after payout within that circle because no round remains. `test_everySeatCannotProfitByDefaultingAfterPayoutWhenOthersStayGood` checks all 54 seat/count combinations for sizes 2–10, with immediate collection of the recipient's pot.

The implementation preserves the explicit approved mechanics. Achieving the stronger guarantee needs an approved change to collateral or settlement design that addresses **both** carry and fallback refunds; silently changing a bond or withholding an approved credit would violate those mechanics. Treat this as a release requirement conflict, not something passing Solidity tests resolves.

## Other properties and review targets

- Fixed supply and constructor deployment are checked with actual runtime, including forbidden-opcode scans and the EIP-170 runtime bound. The application never moves factory funds during construction. The manifest must bind its sole argument to the accepted launch token, not an arbitrary ERC-20.
- Contribution eligibility uses elapsed time and history, not closure progress. Historical payout eligibility is checked through the specific closing round. This prevents late closing from retroactively cancelling an earned turn.
- Withdrawal is caller-only, consumes the full credit before the transfer and is guarded. Failure restores the credit; settlement does not call recipient code. Test mocks exercise false-return tokens, missing return data, short incoming transfers and malicious reentry. Production CIRC has no callbacks or transfer taxes.
- Conservation is checked through an independent prefix-based model and random interleavings across circles; the stateful invariant also settles all circles and collects every remaining credit after each sequence. Direct CIRC donations are explicitly unassigned surplus and do not invalidate liabilities.
- Final division uses one integer share and awards the full remainder to the lowest eligible seat, including when the lowest eligible seat is not zero. No rounding dust remains. If nobody contributes, each bond is returned, avoiding division by zero.
- All public mutators are nonReentrant; loops are bounded by ten seats. No permissioned administration, rescue, pause, ownership handover or upgrade exists. Independent review should still examine token assumptions, deadline liveness, callback paths, arithmetic and all constructor/manifest authorization boundaries.

Independent review, source attestation, policy linkage and actual Sepolia deployment remain downstream responsibilities. No such outcome is claimed by this assignment.
