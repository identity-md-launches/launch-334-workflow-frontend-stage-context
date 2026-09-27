// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SavingsCircleTestBase} from "./SavingsCircle.t.sol";
import {SavingsCircle} from "../src/SavingsCircle.sol";

/// @dev Reference model describes payment prefixes, independently of contract bitmaps and accounting counters.
contract SavingsCircleModelTest is SavingsCircleTestBase {
    function testFuzz_settlementMatchesIndependentModel(
        uint256 seats,
        uint256 amount,
        uint256[10] memory prefixes,
        bool delayClosing
    ) public {
        seats = bound(seats, 2, 10);
        amount = bound(amount, C, 10 * C);
        for (uint256 s; s < seats; ++s) {
            prefixes[s] = bound(prefixes[s], 0, seats);
        }
        uint256 id = _full(amount, seats);
        uint256 start = app.circle(id).start;
        for (uint256 r; r < seats; ++r) {
            for (uint256 s; s < seats; ++s) {
                if (prefixes[s] > r) _pay(id, s);
            }
            vm.warp(start + (r + 1) * LENGTH);
            if (!delayClosing) {
                app.closeRound(id, r);
                _conserved();
            }
        }
        if (delayClosing) {
            for (uint256 r; r < seats; ++r) {
                app.closeRound(id, r);
                _conserved();
            }
        }
        uint256[10] memory expected = _model(seats, amount, prefixes);
        for (uint256 s; s < seats; ++s) {
            assertEq(app.withdrawable(users[s]), expected[s], "reference settlement differs");
            assertEq(app.inDefault(id, users[s]), prefixes[s] < seats);
        }
        _withdrawAll();
        assertEq(token.balanceOf(address(app)), 0);
    }

    function test_everySeatCannotProfitByDefaultingAfterPayoutWhenOthersStayGood() public {
        for (uint256 seats = 2; seats <= 10; ++seats) {
            for (uint256 target; target < seats; ++target) {
                uint256 beforeBalance = token.balanceOf(users[target]);
                uint256 id = _full(C, seats);
                uint256 start = app.circle(id).start;
                for (uint256 r; r < seats; ++r) {
                    for (uint256 s; s < seats; ++s) {
                        if (s != target || r <= target) {
                            vm.prank(users[s]);
                            app.contribute(id);
                        }
                    }
                    vm.warp(start + (r + 1) * LENGTH);
                    app.closeRound(id, r);
                    // An early recipient can pull the payout immediately, then abandon the circle.
                    if (r == target) {
                        vm.prank(users[target]);
                        app.withdraw();
                    }
                }
                _withdrawAll();
                assertLe(token.balanceOf(users[target]), beforeBalance, "single defaulter profits");
                if (target + 1 < seats) {
                    assertTrue(app.inDefault(id, users[target]));
                    assertEq(token.balanceOf(users[target]), beforeBalance - target * C);
                }
            }
        }
    }

    /// @notice Regression documenting a conflict in the approved economic guarantee, not a claimed guarantee.
    function test_specificationCounterexampleAllDefaultFallbackCanProfitEarlyRecipient() public {
        uint256 initial = token.balanceOf(users[0]);
        uint256 id = _full(C, 2);
        _pay(id, 0);
        _pay(id, 1);
        vm.warp(block.timestamp + LENGTH);
        app.closeRound(id, 0);
        vm.prank(users[0]);
        app.withdraw();
        assertEq(token.balanceOf(users[0]), initial); // The bond initially covers the entire early payout.
        vm.warp(block.timestamp + LENGTH);
        app.closeRound(id, 1); // Both default: the mandated fallback returns one bond to each contributor.
        assertTrue(app.inDefault(id, users[0]));
        assertTrue(app.inDefault(id, users[1]));
        _withdrawAll();
        assertEq(token.balanceOf(users[0]), initial + C);
        assertEq(token.balanceOf(users[1]), initial - C);
    }

    /// @notice A second counterexample: carry can defeat the fixed bond even with two good members.
    function test_specificationCounterexampleCarryCanProfitDefaulterWithGoodMembers() public {
        uint256 initial = token.balanceOf(users[1]);
        uint256 id = _full(C, 4);
        uint256 start = app.circle(id).start;
        for (uint256 r; r < 4; ++r) {
            // Seat zero never pays. Seat one receives carry, then stops. Seats two and three stay good.
            if (r < 2) _pay(id, 1);
            _pay(id, 2);
            _pay(id, 3);
            vm.warp(start + (r + 1) * LENGTH);
            app.closeRound(id, r);
            if (r == 1) {
                assertEq(app.withdrawable(users[1]), 6 * C);
                vm.prank(users[1]);
                app.withdraw();
            }
        }
        assertTrue(app.inDefault(id, users[1]));
        assertFalse(app.inDefault(id, users[2]));
        assertFalse(app.inDefault(id, users[3]));
        _withdrawAll();
        assertEq(token.balanceOf(users[1]), initial + C); // Six in, three bond plus two payments out.
    }

    function _model(uint256 seats, uint256 amount, uint256[10] memory prefixes)
        private
        pure
        returns (uint256[10] memory credits)
    {
        uint256 carry;
        for (uint256 r; r < seats; ++r) {
            for (uint256 s; s < seats; ++s) {
                if (prefixes[s] > r) carry += amount;
            }
            if (prefixes[r] > r) {
                credits[r] += carry;
                carry = 0;
            }
        }
        uint256 bond = (seats - 1) * amount;
        uint256 good;
        uint256 ever;
        for (uint256 s; s < seats; ++s) {
            if (prefixes[s] == seats) {
                ++good;
                credits[s] += bond;
            }
            if (prefixes[s] > 0) ++ever;
        }
        if (ever == 0) {
            for (uint256 s; s < seats; ++s) {
                credits[s] += bond;
            }
            return credits;
        }
        uint256 pool = carry + (seats - good) * bond;
        uint256 count = good == 0 ? ever : good;
        uint256 remainder = pool % count;
        for (uint256 s; s < seats; ++s) {
            bool eligible = good == 0 ? prefixes[s] > 0 : prefixes[s] == seats;
            if (eligible) {
                credits[s] += pool / count + remainder;
                remainder = 0;
            }
        }
    }
}
