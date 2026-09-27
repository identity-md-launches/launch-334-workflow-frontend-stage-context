// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {SavingsCircle} from "../src/SavingsCircle.sol";

contract CircleHandler is Test {
    LaunchToken public immutable token;
    SavingsCircle public immutable app;
    address[10] public actors;
    uint256 public deposited;
    uint256 public withdrawn;
    uint256 public successfulActions;

    constructor(LaunchToken token_, SavingsCircle app_) {
        token = token_;
        app = app_;
        for (uint256 i; i < 10; ++i) {
            actors[i] = address(uint160(1_000 + i));
            vm.prank(actors[i]);
            token.approve(address(app), type(uint256).max);
        }
    }

    function create(uint256 actorSeed, uint256 seatsSeed, uint256 amountSeed, uint256 lengthSeed) public {
        if (app.circleCount() >= 6) return;
        uint256 seats = bound(seatsSeed, 2, 10);
        uint256 amount = bound(amountSeed, 1 ether, 3 ether);
        uint256 length = bound(lengthSeed, 1 hours, 30 days);
        vm.prank(actors[actorSeed % 10]);
        app.create(amount, length, seats);
        deposited += (seats - 1) * amount;
        ++successfulActions;
    }

    function join(uint256 idSeed, uint256 actorSeed) public {
        if (app.circleCount() == 0) return;
        uint256 id = idSeed % app.circleCount();
        SavingsCircle.Circle memory c = app.circle(id);
        if (c.state != SavingsCircle.State.Recruiting || block.timestamp >= c.createdAt + 7 days) return;
        address actor = actors[actorSeed % 10];
        if (_isMember(id, actor, c.joined)) return;
        vm.prank(actor);
        app.join(id);
        deposited += (c.seats - 1) * c.contribution;
        ++successfulActions;
    }

    function contribute(uint256 idSeed, uint256 actorSeed) external {
        if (app.circleCount() == 0) return;
        uint256 id = idSeed % app.circleCount();
        SavingsCircle.Circle memory c = app.circle(id);
        if (c.state != SavingsCircle.State.Active) return;
        uint256 r = app.currentRound(id);
        if (r >= c.seats) return;
        address actor = actors[actorSeed % 10];
        if (!_isMember(id, actor, c.joined) || app.inDefault(id, actor)) return;
        if (app.paidRounds(id, actor) & (1 << r) != 0) return;
        vm.prank(actor);
        app.contribute(id);
        deposited += c.contribution;
        ++successfulActions;
    }

    function close(uint256 idSeed) external {
        if (app.circleCount() == 0) return;
        uint256 id = idSeed % app.circleCount();
        SavingsCircle.Circle memory c = app.circle(id);
        if (c.state != SavingsCircle.State.Active || c.nextRound >= app.currentRound(id)) return;
        app.closeRound(id, c.nextRound);
        ++successfulActions;
    }

    function cancel(uint256 idSeed) external {
        if (app.circleCount() == 0) return;
        uint256 id = idSeed % app.circleCount();
        SavingsCircle.Circle memory c = app.circle(id);
        if (c.state != SavingsCircle.State.Recruiting || block.timestamp < c.createdAt + 7 days) return;
        app.cancel(id);
        ++successfulActions;
    }

    function withdraw(uint256 actorSeed) external {
        address actor = actors[actorSeed % 10];
        uint256 credit = app.withdrawable(actor);
        if (credit == 0) return;
        uint256 before = token.balanceOf(actor);
        vm.prank(actor);
        app.withdraw();
        assertEq(token.balanceOf(actor), before + credit);
        withdrawn += credit;
        ++successfulActions;
    }

    function advance(uint256 delta) external {
        vm.warp(block.timestamp + bound(delta, 0, 2 days));
    }

    function _isMember(uint256 id, address actor, uint256 joined) private view returns (bool) {
        for (uint256 s; s < joined; ++s) {
            if (app.member(id, s) == actor) return true;
        }
        return false;
    }
}

contract SavingsCircleInvariantTest is StdInvariant, Test {
    LaunchToken private token;
    SavingsCircle private app;
    CircleHandler private handler;

    function setUp() public {
        vm.warp(100 days);
        token = new LaunchToken();
        app = new SavingsCircle(address(token));
        handler = new CircleHandler(token, app);
        for (uint256 i; i < 10; ++i) {
            token.transfer(handler.actors(i), 1_000 ether);
        }
        handler.create(0, 2, 1 ether, 1 hours);
        handler.join(0, 1);
        handler.create(0, 3, 1 ether + 1, 1 days);
        handler.join(1, 1);
        handler.join(1, 2);
        handler.create(3, 10, 2 ether + 3, 30 days);

        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = handler.create.selector;
        selectors[1] = handler.join.selector;
        selectors[2] = handler.contribute.selector;
        selectors[3] = handler.close.selector;
        selectors[4] = handler.cancel.selector;
        selectors[5] = handler.withdraw.selector;
        selectors[6] = handler.advance.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_custodyEqualsAllLiabilitiesAndGhostNetDeposits() public view {
        uint256 bonds;
        uint256 pots;
        uint256 carry;
        uint256 credits;
        for (uint256 id; id < app.circleCount(); ++id) {
            SavingsCircle.Circle memory c = app.circle(id);
            bonds += c.bondsHeld;
            pots += c.openPots;
            carry += c.carry;
            uint256 independentPots;
            for (uint256 r; r < c.seats; ++r) {
                uint256 actual = app.roundPot(id, r);
                if (r < c.nextRound) {
                    assertEq(actual, 0);
                } else {
                    uint256 paid;
                    for (uint256 s; s < c.joined; ++s) {
                        if (app.paidRounds(id, app.member(id, s)) & (1 << r) != 0) ++paid;
                    }
                    assertEq(actual, paid * c.contribution);
                }
                independentPots += actual;
            }
            assertEq(c.openPots, independentPots);
            if (c.state == SavingsCircle.State.Cancelled || c.state == SavingsCircle.State.Finalized) {
                assertEq(c.bondsHeld + c.openPots + c.carry, 0);
            } else {
                assertEq(c.bondsHeld, c.joined * (c.seats - 1) * c.contribution);
            }
        }
        for (uint256 i; i < 10; ++i) {
            credits += app.withdrawable(handler.actors(i));
        }
        assertEq(app.totalBonds(), bonds);
        assertEq(app.totalOpenPots(), pots);
        assertEq(app.totalCarry(), carry);
        assertEq(app.totalWithdrawable(), credits);
        assertEq(token.balanceOf(address(app)), bonds + pots + carry + credits);
        assertEq(token.balanceOf(address(app)), handler.deposited() - handler.withdrawn());
        assertEq(token.totalSupply(), 1e27);
    }

    /// @dev Every random prefix can be completed permissionlessly and every remaining liability can be collected.
    function afterInvariant() public {
        vm.warp(block.timestamp + 301 days);
        for (uint256 id; id < app.circleCount(); ++id) {
            SavingsCircle.Circle memory c = app.circle(id);
            if (c.state == SavingsCircle.State.Recruiting) app.cancel(id);
            if (c.state == SavingsCircle.State.Active) {
                for (uint256 r = c.nextRound; r < c.seats; ++r) {
                    app.closeRound(id, r);
                }
            }
        }
        for (uint256 i; i < 10; ++i) {
            address actor = handler.actors(i);
            if (app.withdrawable(actor) != 0) {
                vm.prank(actor);
                app.withdraw();
            }
        }
        assertEq(token.balanceOf(address(app)), 0);
        assertEq(app.accountedBalance(), 0);
    }
}
