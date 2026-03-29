// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {AgentErc20PeriodicOutgoingBudgetPolicy, PackedUserOperation} from "../src/AgentErc20PeriodicOutgoingBudgetPolicy.sol";

interface Vm {
    function warp(uint256 newTimestamp) external;
}

contract AgentErc20PeriodicOutgoingBudgetPolicyTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    AgentErc20PeriodicOutgoingBudgetPolicy private policy;

    bytes32 private constant PERMISSION_ID = keccak256("permission");
    address private constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address private constant RECIPIENT = address(0xBEEF);
    address private constant SPENDER = address(0xCAFE);
    uint48 private constant WEEK = 604800;
    uint48 private constant DAY = 86_400;
    uint48 private constant MONTH = 2_592_000;
    uint48 private constant FIFTEEN_MINUTES = 900;
    uint48 private constant HOUR = 3600;
    uint48 private constant TWELVE_HOURS = 43_200;
    uint256 private constant INITIAL_TIMESTAMP = 1_710_000_000;
    uint8 private constant TRANSFER_AND_APPROVE = 0x03;

    function setUp() public {
        vm.warp(INITIAL_TIMESTAMP);
        _installPolicy(WEEK, 25_000_000);
    }

    function testAllowsTransferWithinWeeklyLimit() public {
        uint48 currentBucketStart = _currentHourStart(block.timestamp);
        uint256 validationData = policy.checkUserOpPolicy(PERMISSION_ID, _buildTransferUserOp(10_000_000));

        _assertEq(validationData, 0, "expected policy to accept transfer within weekly cap");
        _assertEq(
            policy.currentWindowSpent(address(this), PERMISSION_ID),
            10_000_000,
            "expected rolling spend to be updated"
        );
        _assertEq(
            policy.bucketAmountAt(address(this), PERMISSION_ID, currentBucketStart),
            10_000_000,
            "expected current hourly bucket spend to be updated"
        );
    }

    function testRejectsTransferAboveRemainingWeeklyLimit() public {
        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, _buildTransferUserOp(20_000_000)), 0, "first transfer should pass");
        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, _buildTransferUserOp(6_000_000)), 1, "second transfer should fail");
    }

    function testCountsApproveAgainstTheOutgoingBudget() public {
        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, _buildApproveUserOp(10_000_000)), 0, "approve should count");
        _assertEq(policy.currentWindowSpent(address(this), PERMISSION_ID), 10_000_000, "approve should consume the budget");
        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, _buildTransferUserOp(15_000_001)), 1, "combined outgoing usage should be enforced");
    }

    function testExpiresSpendOnceTheOldestHourlyBucketLeavesTheWindow() public {
        uint48 firstBucketStart = _currentHourStart(block.timestamp);

        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, _buildTransferUserOp(25_000_000)), 0, "initial spend should pass");
        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, _buildTransferUserOp(1)), 1, "window should be exhausted");

        vm.warp(uint256(firstBucketStart) + WEEK - 1);
        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, _buildTransferUserOp(1)), 1, "oldest hourly bucket should still count");

        vm.warp(uint256(firstBucketStart) + WEEK);
        uint48 recycledBucketStart = _currentHourStart(block.timestamp);
        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, _buildTransferUserOp(25_000_000)), 0, "expired hourly bucket should no longer count");
        _assertEq(
            policy.currentWindowSpent(address(this), PERMISSION_ID),
            25_000_000,
            "expected rolling spend to include only the fresh transfer"
        );
        _assertEq(
            policy.bucketAmountAt(address(this), PERMISSION_ID, firstBucketStart),
            0,
            "expected recycled slot to stop reporting the expired bucket"
        );
        _assertEq(
            policy.bucketAmountAt(address(this), PERMISSION_ID, recycledBucketStart),
            25_000_000,
            "expected recycled slot to report the fresh bucket"
        );
    }

    function testExpiresSpendOnceTheOldestQuarterHourBucketLeavesTheDailyWindow() public {
        _installPolicy(DAY, 25_000_000);
        uint48 firstBucketStart = _currentQuarterHourStart(block.timestamp);

        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, _buildTransferUserOp(25_000_000)), 0, "initial spend should pass");
        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, _buildTransferUserOp(1)), 1, "window should be exhausted");

        vm.warp(uint256(firstBucketStart) + DAY - 1);
        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, _buildTransferUserOp(1)), 1, "oldest quarter-hour bucket should still count");

        vm.warp(uint256(firstBucketStart) + DAY);
        uint48 recycledBucketStart = _currentQuarterHourStart(block.timestamp);
        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, _buildTransferUserOp(25_000_000)), 0, "expired quarter-hour bucket should no longer count");
        _assertEq(
            policy.currentWindowSpent(address(this), PERMISSION_ID),
            25_000_000,
            "expected rolling spend to include only the fresh transfer"
        );
        _assertEq(
            policy.bucketAmountAt(address(this), PERMISSION_ID, firstBucketStart),
            0,
            "expected recycled slot to stop reporting the expired quarter-hour bucket"
        );
        _assertEq(
            policy.bucketAmountAt(address(this), PERMISSION_ID, recycledBucketStart),
            25_000_000,
            "expected recycled slot to report the fresh quarter-hour bucket"
        );
    }

    function testExpiresSpendOnceTheOldestTwelveHourBucketLeavesTheMonthlyWindow() public {
        _installPolicy(MONTH, 25_000_000);
        uint48 firstBucketStart = _currentTwelveHourStart(block.timestamp);

        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, _buildTransferUserOp(25_000_000)), 0, "initial spend should pass");
        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, _buildTransferUserOp(1)), 1, "window should be exhausted");

        vm.warp(uint256(firstBucketStart) + MONTH - 1);
        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, _buildTransferUserOp(1)), 1, "oldest twelve-hour bucket should still count");

        vm.warp(uint256(firstBucketStart) + MONTH);
        uint48 recycledBucketStart = _currentTwelveHourStart(block.timestamp);
        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, _buildTransferUserOp(25_000_000)), 0, "expired twelve-hour bucket should no longer count");
        _assertEq(
            policy.currentWindowSpent(address(this), PERMISSION_ID),
            25_000_000,
            "expected rolling spend to include only the fresh transfer"
        );
        _assertEq(
            policy.bucketAmountAt(address(this), PERMISSION_ID, firstBucketStart),
            0,
            "expected recycled slot to stop reporting the expired twelve-hour bucket"
        );
        _assertEq(
            policy.bucketAmountAt(address(this), PERMISSION_ID, recycledBucketStart),
            25_000_000,
            "expected recycled slot to report the fresh twelve-hour bucket"
        );
    }

    function testRejectsNonWhitelistedCounterparties() public {
        PackedUserOperation memory transferUserOp =
            _buildUserOp(abi.encodeWithSelector(bytes4(0xa9059cbb), address(0xDEAD), uint256(10_000_000)));
        PackedUserOperation memory approveUserOp =
            _buildUserOp(abi.encodeWithSelector(bytes4(0x095ea7b3), address(0xDEAD), uint256(10_000_000)));

        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, transferUserOp), 1, "transfer recipient should be whitelisted");
        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, approveUserOp), 1, "approve spender should be whitelisted");
    }

    function testRejectsUnsupportedSelectors() public {
        PackedUserOperation memory userOp = _buildUserOp(
            abi.encodeWithSelector(bytes4(0x40c10f19), RECIPIENT, uint256(10_000_000))
        );

        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, userOp), 1, "unsupported selectors should fail");
    }

    function testRejectsWrongTarget() public {
        PackedUserOperation memory userOp = _buildUserOpForTarget(
            address(0xCAFE),
            abi.encodeWithSelector(bytes4(0xa9059cbb), RECIPIENT, uint256(10_000_000))
        );

        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, userOp), 1, "wrong target should fail");
    }

    function _buildTransferUserOp(uint256 amount) private pure returns (PackedUserOperation memory) {
        return _buildUserOp(abi.encodeWithSelector(bytes4(0xa9059cbb), RECIPIENT, amount));
    }

    function _buildApproveUserOp(uint256 amount) private pure returns (PackedUserOperation memory) {
        return _buildUserOp(abi.encodeWithSelector(bytes4(0x095ea7b3), SPENDER, amount));
    }

    function _buildUserOp(bytes memory tokenCallData) private pure returns (PackedUserOperation memory) {
        return _buildUserOpForTarget(USDC, tokenCallData);
    }

    function _buildUserOpForTarget(address target, bytes memory tokenCallData)
        private
        pure
        returns (PackedUserOperation memory userOp)
    {
        bytes memory executionCalldata = abi.encodePacked(target, uint256(0), tokenCallData);
        userOp.callData = abi.encodeWithSignature("execute(bytes32,bytes)", bytes32(0), executionCalldata);
    }

    function _currentHourStart(uint256 timestamp) private pure returns (uint48) {
        return uint48((timestamp / HOUR) * HOUR);
    }

    function _currentQuarterHourStart(uint256 timestamp) private pure returns (uint48) {
        return uint48((timestamp / FIFTEEN_MINUTES) * FIFTEEN_MINUTES);
    }

    function _currentTwelveHourStart(uint256 timestamp) private pure returns (uint48) {
        return uint48((timestamp / TWELVE_HOURS) * TWELVE_HOURS);
    }

    function _installPolicy(uint48 period, uint256 limit) private {
        policy = new AgentErc20PeriodicOutgoingBudgetPolicy();
        address[] memory allowedCounterparties = new address[](2);
        allowedCounterparties[0] = RECIPIENT;
        allowedCounterparties[1] = SPENDER;
        policy.onInstall(
            abi.encodePacked(PERMISSION_ID, abi.encode(USDC, limit, period, TRANSFER_AND_APPROVE, allowedCounterparties))
        );
    }

    function _assertEq(uint256 actual, uint256 expected, string memory message) private pure {
        if (actual != expected) {
            revert(message);
        }
    }
}
