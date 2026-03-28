// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {AgentErc20PeriodicSpendLimitPolicy, PackedUserOperation} from "../src/AgentErc20PeriodicSpendLimitPolicy.sol";

interface Vm {
    function warp(uint256 newTimestamp) external;
}

contract AgentErc20PeriodicSpendLimitPolicyTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    AgentErc20PeriodicSpendLimitPolicy private policy;

    bytes32 private constant PERMISSION_ID = keccak256("permission");
    address private constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address private constant RECIPIENT = address(0xBEEF);
    uint48 private constant WEEK = 604800;
    uint48 private constant HOUR = 3600;
    uint256 private constant INITIAL_TIMESTAMP = 1_710_000_000;

    function setUp() public {
        vm.warp(INITIAL_TIMESTAMP);
        policy = new AgentErc20PeriodicSpendLimitPolicy();
        policy.onInstall(abi.encodePacked(PERMISSION_ID, abi.encode(USDC, 25_000_000, WEEK)));
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

    function testRejectsUnsupportedSelectors() public {
        PackedUserOperation memory userOp = _buildUserOp(
            abi.encodeWithSelector(bytes4(0x095ea7b3), RECIPIENT, uint256(10_000_000))
        );

        _assertEq(policy.checkUserOpPolicy(PERMISSION_ID, userOp), 1, "approve should not be allowed");
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

    function _assertEq(uint256 actual, uint256 expected, string memory message) private pure {
        if (actual != expected) {
            revert(message);
        }
    }
}
