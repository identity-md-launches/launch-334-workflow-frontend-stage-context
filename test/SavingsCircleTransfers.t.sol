// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SavingsCircle} from "../src/SavingsCircle.sol";

/// @dev Only a test dependency. CIRC has none of these behaviors or administrative capabilities.
contract AdversarialToken is ERC20 {
    bool public rejectIn;
    bool public shortIn;
    bool public noReturn;
    address public rejectedRecipient;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackSucceeded;
    bytes public callbackResult;

    constructor() ERC20("Mock", "MOCK") {
        _mint(msg.sender, 1_000 ether);
    }

    function setIncoming(bool reject, bool shortCredit, bool emptyReturn) external {
        rejectIn = reject;
        shortIn = shortCredit;
        noReturn = emptyReturn;
    }

    function setRejectedRecipient(address account) external {
        rejectedRecipient = account;
    }

    function setCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (rejectIn) return false;
        _callback();
        bool success = super.transferFrom(from, to, value);
        if (shortIn && value != 0) _burn(to, 1);
        if (noReturn) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        return success;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (to == rejectedRecipient) return false;
        _callback();
        bool success = super.transfer(to, value);
        if (noReturn) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        return success;
    }

    function _callback() private {
        if (callbackTarget != address(0)) {
            (callbackSucceeded, callbackResult) = callbackTarget.call(callbackData);
        }
    }
}

contract SavingsCircleTransfersTest is Test {
    AdversarialToken private token;
    SavingsCircle private app;
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    function setUp() public {
        token = new AdversarialToken();
        app = new SavingsCircle(address(token));
        token.transfer(ALICE, 100 ether);
        token.transfer(BOB, 100 ether);
        vm.prank(ALICE);
        token.approve(address(app), type(uint256).max);
        vm.prank(BOB);
        token.approve(address(app), type(uint256).max);
    }

    function test_falseReturningOrFeeIncomingTransfersRevertAtomically() public {
        token.setIncoming(true, false, false);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token)));
        vm.prank(ALICE);
        app.create(1 ether, 1 hours, 2);
        assertEq(app.circleCount(), 0);
        assertEq(app.totalBonds(), 0);
        token.setIncoming(false, true, false);
        vm.expectRevert(SavingsCircle.UnexpectedTransferAmount.selector);
        vm.prank(ALICE);
        app.create(1 ether, 1 hours, 2);
        assertEq(app.circleCount(), 0);
        assertEq(token.balanceOf(ALICE), 100 ether);
        assertEq(token.balanceOf(address(app)), 0);
    }

    function test_noReturnTokenWorksThroughSafeERC20() public {
        token.setIncoming(false, false, true);
        vm.prank(ALICE);
        uint256 id = app.create(1 ether, 1 hours, 2);
        vm.warp(block.timestamp + 7 days);
        app.cancel(id);
        vm.prank(ALICE);
        app.withdraw();
        assertEq(token.balanceOf(ALICE), 100 ether);
        assertEq(app.accountedBalance(), 0);
    }

    function test_failedWithdrawalPreservesCreditAndDoesNotBlockOthers() public {
        vm.prank(ALICE);
        uint256 id = app.create(1 ether, 1 hours, 3);
        vm.prank(BOB);
        app.join(id);
        token.setRejectedRecipient(ALICE);
        vm.warp(block.timestamp + 7 days);
        app.cancel(id); // Settlement itself makes no transfers and cannot be blocked by ALICE.
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token)));
        vm.prank(ALICE);
        app.withdraw();
        assertEq(app.withdrawable(ALICE), 2 ether);
        assertEq(app.totalWithdrawable(), 4 ether);
        vm.prank(BOB);
        app.withdraw();
        assertEq(token.balanceOf(BOB), 100 ether);
        assertEq(app.totalWithdrawable(), 2 ether);
        token.setRejectedRecipient(address(0));
        vm.prank(ALICE);
        app.withdraw();
        assertEq(token.balanceOf(ALICE), 100 ether);
        assertEq(token.balanceOf(address(app)), 0);
    }

    function test_reentrancyBlockedDuringCreateJoinContributeAndWithdraw() public {
        token.setCallback(address(app), abi.encodeCall(app.create, (1 ether, 1 hours, 2)));
        vm.prank(ALICE);
        uint256 id = app.create(1 ether, 1 hours, 2);
        _assertBlocked();
        assertEq(app.circleCount(), 1);
        token.setCallback(address(app), abi.encodeCall(app.join, (id)));
        vm.prank(BOB);
        app.join(id);
        _assertBlocked();
        assertEq(app.circle(id).joined, 2);
        token.setCallback(address(app), abi.encodeCall(app.contribute, (id)));
        vm.prank(ALICE);
        app.contribute(id);
        _assertBlocked();
        assertEq(app.roundPot(id, 0), 1 ether);
        vm.warp(block.timestamp + 1 hours);
        app.closeRound(id, 0);
        token.setCallback(address(app), abi.encodeCall(app.withdraw, ()));
        vm.prank(ALICE);
        app.withdraw();
        _assertBlocked();
        assertEq(app.withdrawable(ALICE), 0);
        assertEq(token.balanceOf(address(app)), app.accountedBalance());
    }

    function _assertBlocked() private view {
        assertFalse(token.callbackSucceeded());
        assertEq(token.callbackResult(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
    }
}
