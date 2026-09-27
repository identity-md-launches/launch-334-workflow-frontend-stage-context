// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {SavingsCircle} from "../src/SavingsCircle.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract LaunchTokenTest is Test {
    LaunchToken private token;
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    function setUp() public {
        token = new LaunchToken();
    }

    function test_supplyMetadataAndFactoryDeployment() public {
        assertEq(token.name(), "Circle");
        assertEq(token.symbol(), "CIRC");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1e27);
        assertEq(token.balanceOf(address(this)), 1e27);
        SavingsCircle app = new SavingsCircle(address(token));
        assertEq(address(app.token()), address(token));
        assertEq(token.balanceOf(address(app)), 0);
        assertEq(token.balanceOf(address(this)), 1e27);
        assertEq(app.circleCount(), 0);
        assertEq(app.accountedBalance(), 0);
        _checkRuntime(address(token));
        _checkRuntime(address(app));
    }

    function testFuzz_exactTransfersAndFixedSupply(uint256 amount) public {
        amount = bound(amount, 0, 1e27);
        assertTrue(token.transfer(ALICE, amount));
        assertEq(token.balanceOf(ALICE), amount);
        assertEq(token.balanceOf(address(this)), 1e27 - amount);
        assertEq(token.totalSupply(), 1e27);
    }

    function test_approveTransferFromAndAllowanceConsumption() public {
        token.transfer(ALICE, 10 ether);
        vm.prank(ALICE);
        token.approve(BOB, 4 ether);
        vm.prank(BOB);
        token.transferFrom(ALICE, BOB, 3 ether);
        assertEq(token.balanceOf(ALICE), 7 ether);
        assertEq(token.balanceOf(BOB), 3 ether);
        assertEq(token.allowance(ALICE, BOB), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, BOB, 1 ether, 2 ether));
        vm.prank(BOB);
        token.transferFrom(ALICE, BOB, 2 ether);
    }

    function test_invalidTransfersAndAbsentAdminSelectors() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        token.transfer(address(0), 1);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, ALICE, 0, 1));
        vm.prank(ALICE);
        token.transfer(BOB, 1);
        string[7] memory selectors = [
            "mint(address,uint256)",
            "transferOwnership(address)",
            "pause()",
            "upgradeTo(address)",
            "initialize(address)",
            "setMinter(address)",
            "burn(uint256)"
        ];
        for (uint256 i; i < selectors.length; ++i) {
            (bool success,) = address(token).call(abi.encodeWithSignature(selectors[i], ALICE, 1 ether));
            assertFalse(success);
            assertEq(token.totalSupply(), 1e27);
            assertEq(token.balanceOf(address(this)), 1e27);
        }
    }

    function _checkRuntime(address deployed) private view {
        bytes memory code = deployed.code;
        assertGt(code.length, 0);
        assertLe(code.length, 24_576);
        for (uint256 i; i < code.length; ++i) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f;
            } else {
                assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff);
            }
        }
    }
}
