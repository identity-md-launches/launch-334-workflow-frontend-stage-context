// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {SavingsCircle} from "../src/SavingsCircle.sol";

abstract contract SavingsCircleTestBase is Test {
    LaunchToken internal token;
    SavingsCircle internal app;
    address[11] internal users;
    uint256 internal constant C = 1 ether;
    uint256 internal constant LENGTH = 1 hours;

    function setUp() public {
        vm.warp(100 days);
        token = new LaunchToken();
        app = new SavingsCircle(address(token));
        for (uint256 i; i < users.length; ++i) {
            users[i] = address(uint160(100 + i));
            token.transfer(users[i], 10_000 ether);
            vm.prank(users[i]);
            token.approve(address(app), type(uint256).max);
        }
    }

    function _create(uint256 amount, uint256 seats) internal returns (uint256 id) {
        vm.prank(users[0]);
        id = app.create(amount, LENGTH, seats);
    }

    function _full(uint256 amount, uint256 seats) internal returns (uint256 id) {
        id = _create(amount, seats);
        for (uint256 i = 1; i < seats; ++i) {
            vm.prank(users[i]);
            app.join(id);
        }
        _conserved();
    }

    function _pay(uint256 id, uint256 seat) internal {
        vm.prank(users[seat]);
        app.contribute(id);
        _conserved();
    }

    function _withdrawAll() internal {
        for (uint256 i; i < users.length; ++i) {
            if (app.withdrawable(users[i]) != 0) {
                vm.prank(users[i]);
                app.withdraw();
            }
        }
        _conserved();
    }

    function _conserved() internal view {
        uint256 bonds;
        uint256 pots;
        uint256 carry;
        uint256 credits;
        for (uint256 id; id < app.circleCount(); ++id) {
            SavingsCircle.Circle memory c = app.circle(id);
            bonds += c.bondsHeld;
            pots += c.openPots;
            carry += c.carry;
        }
        for (uint256 i; i < users.length; ++i) {
            credits += app.withdrawable(users[i]);
        }
        assertEq(bonds, app.totalBonds());
        assertEq(pots, app.totalOpenPots());
        assertEq(carry, app.totalCarry());
        assertEq(credits, app.totalWithdrawable());
        assertEq(token.balanceOf(address(app)), bonds + pots + carry + credits);
        assertEq(token.balanceOf(address(app)), app.accountedBalance());
    }
}

contract SavingsCircleTest is SavingsCircleTestBase {
    function test_creationBoundsAndConstructorValidation() public {
        vm.expectRevert(SavingsCircle.InvalidToken.selector);
        this.deployForTest(address(0));
        vm.expectRevert(SavingsCircle.InvalidToken.selector);
        this.deployForTest(users[0]);
        vm.startPrank(users[0]);
        vm.expectRevert(SavingsCircle.InvalidContribution.selector);
        app.create(C - 1, LENGTH, 2);
        vm.expectRevert(SavingsCircle.InvalidContribution.selector);
        app.create(type(uint256).max, LENGTH, 3);
        vm.expectRevert(SavingsCircle.InvalidSeats.selector);
        app.create(C, LENGTH, 1);
        vm.expectRevert(SavingsCircle.InvalidSeats.selector);
        app.create(C, LENGTH, 11);
        vm.expectRevert(SavingsCircle.InvalidRoundLength.selector);
        app.create(C, LENGTH - 1, 2);
        vm.expectRevert(SavingsCircle.InvalidRoundLength.selector);
        app.create(C, 30 days + 1, 2);
        app.create(C, 30 days, 2);
        vm.stopPrank();
        assertEq(app.circleCount(), 1);
        assertEq(app.member(0, 0), users[0]);
        assertEq(app.circle(0).bondsHeld, C);
        assertEq(app.currentRound(0), 0);
        assertFalse(app.inDefault(0, users[0]));
        _conserved();
    }

    function deployForTest(address tokenAddress) external returns (SavingsCircle) {
        return new SavingsCircle(tokenAddress);
    }

    function test_seatLimitsDuplicatesAndActivation() public {
        uint256 id = _create(C, 10);
        vm.expectRevert(SavingsCircle.AlreadyMember.selector);
        vm.prank(users[0]);
        app.join(id);
        assertEq(app.circle(id).bondsHeld, 9 * C);
        vm.expectRevert(SavingsCircle.WrongState.selector);
        vm.prank(users[0]);
        app.contribute(id);
        for (uint256 i = 1; i < 10; ++i) {
            vm.prank(users[i]);
            app.join(id);
            assertEq(app.member(id, i), users[i]);
        }
        SavingsCircle.Circle memory c = app.circle(id);
        assertEq(uint256(c.state), uint256(SavingsCircle.State.Active));
        assertEq(c.start, block.timestamp);
        assertEq(c.joined, 10);
        assertEq(c.bondsHeld, 90 * C);
        vm.expectRevert(SavingsCircle.WrongState.selector);
        vm.prank(users[10]);
        app.join(id);
        vm.expectRevert(SavingsCircle.WrongState.selector);
        app.cancel(id);
        _conserved();
    }

    function test_cancelAtExactDeadlineCreditsEachBondOnce() public {
        uint256 id = _create(C, 3);
        vm.prank(users[1]);
        app.join(id);
        uint256 deadline = app.circle(id).createdAt + 7 days;
        vm.warp(deadline - 1);
        vm.expectRevert(SavingsCircle.CancellationTooEarly.selector);
        app.cancel(id);
        vm.warp(deadline);
        vm.expectRevert(SavingsCircle.JoinExpired.selector);
        vm.prank(users[2]);
        app.join(id);
        vm.prank(users[10]);
        app.cancel(id);
        assertEq(uint256(app.circle(id).state), uint256(SavingsCircle.State.Cancelled));
        assertEq(app.withdrawable(users[0]), 2 * C);
        assertEq(app.withdrawable(users[1]), 2 * C);
        assertEq(app.totalBonds(), 0);
        vm.expectRevert(SavingsCircle.WrongState.selector);
        app.cancel(id);
        vm.expectRevert(SavingsCircle.WrongState.selector);
        vm.prank(users[2]);
        app.join(id);
        assertFalse(app.inDefault(id, users[0]));
        _withdrawAll();
        assertEq(token.balanceOf(users[0]), 10_000 ether);
        assertEq(token.balanceOf(users[1]), 10_000 ether);
        assertEq(token.balanceOf(address(app)), 0);
    }

    function test_lastSeatBeforeDeadlineStartsAtJoinTime() public {
        uint256 id = _create(C, 2);
        vm.warp(block.timestamp + 7 days - 1);
        vm.prank(users[1]);
        app.join(id);
        assertEq(app.circle(id).start, block.timestamp);
        _pay(id, 0);
        vm.warp(block.timestamp + 1);
        vm.expectRevert(SavingsCircle.WrongState.selector);
        app.cancel(id);
        _conserved();
    }

    function test_exactRoundEdgesAndDoublePayment() public {
        uint256 id = _full(C, 2);
        uint256 start = app.circle(id).start;
        _pay(id, 0);
        vm.expectRevert(SavingsCircle.AlreadyContributed.selector);
        vm.prank(users[0]);
        app.contribute(id);
        vm.warp(start + LENGTH - 1);
        assertEq(app.currentRound(id), 0);
        _pay(id, 1);
        vm.expectRevert(SavingsCircle.RoundNotEnded.selector);
        app.closeRound(id, 0);
        vm.warp(start + LENGTH);
        assertEq(app.currentRound(id), 1);
        _pay(id, 0);
        app.closeRound(id, 0);
        assertEq(app.withdrawable(users[0]), 2 * C);
        assertEq(app.roundPot(id, 0), 0);
        assertEq(app.roundPot(id, 1), C);
        vm.warp(start + 2 * LENGTH - 1);
        _pay(id, 1);
        vm.warp(start + 2 * LENGTH);
        assertEq(app.currentRound(id), 2);
        vm.expectRevert(SavingsCircle.RoundWindowEnded.selector);
        vm.prank(users[0]);
        app.contribute(id);
        app.closeRound(id, 1);
        assertEq(app.withdrawable(users[0]), 3 * C);
        assertEq(app.withdrawable(users[1]), 3 * C);
        _withdrawAll();
        assertEq(token.balanceOf(address(app)), 0);
    }

    function test_defaultIsImmediateWithoutClosureAndForfeitsLaterTurn() public {
        uint256 id = _full(C, 3);
        uint256 start = app.circle(id).start;
        _pay(id, 0);
        _pay(id, 2);
        assertFalse(app.inDefault(id, users[1]));
        vm.warp(start + LENGTH);
        assertTrue(app.inDefault(id, users[1]));
        assertFalse(app.inDefault(id, users[0]));
        assertFalse(app.inDefault(id, users[10]));
        vm.expectRevert(SavingsCircle.MemberInDefault.selector);
        vm.prank(users[1]);
        app.contribute(id);
        _pay(id, 0);
        _pay(id, 2);
        vm.warp(start + 2 * LENGTH);
        app.closeRound(id, 0);
        assertEq(app.withdrawable(users[0]), 2 * C);
        vm.expectEmit(true, true, true, true, address(app));
        emit SavingsCircle.RoundClosed(id, 1, address(0), 2 * C, true);
        app.closeRound(id, 1);
        assertEq(app.circle(id).carry, 2 * C);
        assertEq(app.totalCarry(), 2 * C);
        _pay(id, 0);
        _pay(id, 2);
        vm.warp(start + 3 * LENGTH);
        vm.expectEmit(true, true, true, true, address(app));
        emit SavingsCircle.RoundClosed(id, 2, users[2], 4 * C, false);
        app.closeRound(id, 2);
        assertEq(app.withdrawable(users[0]), 5 * C);
        assertEq(app.withdrawable(users[1]), 0);
        assertEq(app.withdrawable(users[2]), 7 * C);
        assertEq(app.totalCarry(), 0);
        assertEq(app.totalBonds(), 0);
        _withdrawAll();
    }

    function test_orderEarlyCloseDoubleCloseAndDoubleWithdraw() public {
        uint256 id = _full(C, 2);
        _pay(id, 0);
        _pay(id, 1);
        vm.expectRevert(SavingsCircle.RoundNotEnded.selector);
        app.closeRound(id, 0);
        vm.warp(block.timestamp + LENGTH);
        vm.expectRevert(SavingsCircle.RoundOutOfOrder.selector);
        app.closeRound(id, 1);
        app.closeRound(id, 0);
        vm.expectRevert(SavingsCircle.RoundOutOfOrder.selector);
        app.closeRound(id, 0);
        vm.prank(users[0]);
        app.withdraw();
        vm.expectRevert(SavingsCircle.NothingToWithdraw.selector);
        vm.prank(users[0]);
        app.withdraw();
        vm.warp(block.timestamp + LENGTH);
        app.closeRound(id, 1);
        vm.expectRevert(SavingsCircle.WrongState.selector);
        app.closeRound(id, 1);
        _withdrawAll();
    }

    function test_finalCarryAndForfeitedBondsSplitWithRemainderToLowestGoodSeat() public {
        // Seats zero and four never pay. Three survivors split forfeited bonds and final carry.
        uint256 amount = C + 1;
        uint256 id = _full(amount, 5);
        uint256 start = app.circle(id).start;
        for (uint256 r; r < 5; ++r) {
            for (uint256 seat = 1; seat <= 3; ++seat) {
                _pay(id, seat);
            }
            vm.warp(start + (r + 1) * LENGTH);
            app.closeRound(id, r);
            _conserved();
        }
        uint256 share = (11 * amount) / 3; // Eight forfeited bond units plus three final carry units.
        uint256 rem = (11 * amount) % 3;
        assertGt(rem, 0);
        assertEq(app.withdrawable(users[0]), 0);
        assertEq(app.withdrawable(users[1]), 6 * amount + 4 * amount + share + rem);
        assertEq(app.withdrawable(users[2]), 3 * amount + 4 * amount + share);
        assertEq(app.withdrawable(users[3]), 3 * amount + 4 * amount + share);
        assertEq(app.withdrawable(users[4]), 0);
        _withdrawAll();
    }

    function test_finalSplitWithoutGoodMembersUsesOnlyEverContributors() public {
        uint256 amount = C + 1;
        uint256 id = _full(amount, 4);
        uint256 start = app.circle(id).start;
        _pay(id, 1);
        _pay(id, 2);
        _pay(id, 3);
        vm.warp(start + LENGTH);
        app.closeRound(id, 0); // Three units carry because seat zero missed round zero.
        _pay(id, 2); // Seat two pays once more, but will default in round two.
        vm.warp(start + 4 * LENGTH);
        app.closeRound(id, 1);
        app.closeRound(id, 2);
        app.closeRound(id, 3);
        uint256 pool = 16 * amount; // Twelve bonds plus four contributions, no round recipient was eligible.
        assertEq(app.withdrawable(users[0]), 0);
        assertEq(app.withdrawable(users[1]), pool / 3 + pool % 3);
        assertEq(app.withdrawable(users[2]), pool / 3);
        assertEq(app.withdrawable(users[3]), pool / 3);
        assertTrue(app.inDefault(id, users[2]));
        _withdrawAll();
    }

    function test_nobodyContributesReturnsEveryBond() public {
        uint256 id = _full(C, 10);
        vm.warp(block.timestamp + 10 * LENGTH);
        for (uint256 r; r < 10; ++r) {
            app.closeRound(id, r);
        }
        for (uint256 seat; seat < 10; ++seat) {
            assertTrue(app.inDefault(id, users[seat]));
            assertEq(app.withdrawable(users[seat]), 9 * C);
        }
        _withdrawAll();
        assertEq(token.balanceOf(address(app)), 0);
        for (uint256 seat; seat < 10; ++seat) {
            assertEq(token.balanceOf(users[seat]), 10_000 ether);
        }
    }

    function test_lateClosingPreservesEligibilityAtTheRoundBeingClosed() public {
        uint256 id = _full(C, 3);
        _pay(id, 0);
        _pay(id, 1);
        _pay(id, 2);
        vm.warp(block.timestamp + 3 * LENGTH);
        assertTrue(app.inDefault(id, users[0]));
        // Seat zero earned round zero even though it defaulted in the following round.
        app.closeRound(id, 0);
        assertEq(app.withdrawable(users[0]), 3 * C);
        app.closeRound(id, 1);
        app.closeRound(id, 2);
        _conserved();
    }

    function test_multipleCirclesHaveIndependentMembershipPotsAndCancellation() public {
        uint256 first = _full(C, 2);
        uint256 second = _create(2 * C, 3);
        _pay(first, 0);
        _pay(first, 1);
        vm.warp(block.timestamp + 7 days);
        app.cancel(second);
        app.closeRound(first, 0);
        app.closeRound(first, 1);
        assertEq(app.circleCount(), 2);
        assertEq(app.circle(second).joined, 1);
        assertEq(app.withdrawable(users[0]), 7 * C);
        assertEq(app.withdrawable(users[1]), C);
        _withdrawAll();
    }

    function test_unknownCircleNonmemberAndInvalidViewsRevert() public {
        vm.expectRevert(SavingsCircle.UnknownCircle.selector);
        app.circle(0);
        vm.expectRevert(SavingsCircle.UnknownCircle.selector);
        app.join(0);
        vm.expectRevert(SavingsCircle.UnknownCircle.selector);
        app.cancel(0);
        vm.expectRevert(SavingsCircle.UnknownCircle.selector);
        app.currentRound(0);
        vm.expectRevert(SavingsCircle.UnknownCircle.selector);
        app.inDefault(0, users[0]);
        vm.expectRevert(SavingsCircle.UnknownCircle.selector);
        app.paidRounds(0, users[0]);
        uint256 id = _full(C, 2);
        vm.expectRevert(SavingsCircle.NotMember.selector);
        vm.prank(users[10]);
        app.contribute(id);
        vm.expectRevert(SavingsCircle.InvalidSeat.selector);
        app.member(id, 2);
        vm.expectRevert(SavingsCircle.InvalidRound.selector);
        app.roundPot(id, 2);
        vm.expectRevert(SavingsCircle.NothingToWithdraw.selector);
        vm.prank(users[10]);
        app.withdraw();
    }

    function test_missingApprovalRollsBackCreateJoinAndContribution() public {
        vm.prank(users[0]);
        token.approve(address(app), 0);
        vm.expectRevert();
        vm.prank(users[0]);
        app.create(C, LENGTH, 2);
        assertEq(app.circleCount(), 0);
        assertEq(app.totalBonds(), 0);
        vm.prank(users[0]);
        token.approve(address(app), C);
        uint256 id = _create(C, 2);
        vm.prank(users[1]);
        token.approve(address(app), 0);
        vm.expectRevert();
        vm.prank(users[1]);
        app.join(id);
        assertEq(app.circle(id).joined, 1);
        vm.prank(users[1]);
        token.approve(address(app), C);
        vm.prank(users[1]);
        app.join(id);
        vm.expectRevert();
        vm.prank(users[0]);
        app.contribute(id);
        assertEq(app.paidRounds(id, users[0]), 0);
        assertEq(app.roundPot(id, 0), 0);
        _conserved();
    }

    function test_noPayableOrFallbackEntryPoints() public {
        vm.deal(address(this), 1 ether);
        (bool success,) = address(app).call{value: 1}("");
        assertFalse(success);
        (success,) = address(app).call{value: 1}(abi.encodeCall(app.create, (C, LENGTH, 2)));
        assertFalse(success);
        (success,) = address(app).call(hex"12345678");
        assertFalse(success);
        assertEq(address(app).balance, 0);
    }

    function test_directTokenDonationsAreUnassignedSurplus() public {
        _full(C, 2);
        token.transfer(address(app), 7);
        assertEq(token.balanceOf(address(app)), app.accountedBalance() + 7);
        assertEq(app.totalBonds(), 2 * C);
    }
}
