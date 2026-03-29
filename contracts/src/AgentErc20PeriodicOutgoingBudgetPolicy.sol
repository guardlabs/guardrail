// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

interface IPolicy {
    function onInstall(bytes calldata data) external payable;
    function onUninstall(bytes calldata data) external payable;
    function isModuleType(uint256 moduleTypeId) external view returns (bool);
    function isInitialized(address smartAccount) external view returns (bool);
    function checkUserOpPolicy(bytes32 id, PackedUserOperation calldata userOp) external payable returns (uint256);
    function checkSignaturePolicy(bytes32 id, address sender, bytes32 hash, bytes calldata sig)
        external
        view
        returns (uint256);
}

contract AgentErc20PeriodicOutgoingBudgetPolicy is IPolicy {
    bytes4 private constant EXECUTE_SELECTOR = bytes4(keccak256("execute(bytes32,bytes)"));
    bytes4 private constant EXECUTE_USER_OP_SELECTOR =
        bytes4(
            keccak256(
                "executeUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32)"
            )
        );
    bytes4 private constant ERC20_TRANSFER_SELECTOR = 0xa9059cbb;
    bytes4 private constant ERC20_APPROVE_SELECTOR = 0x095ea7b3;
    uint8 private constant CALLTYPE_SINGLE = 0x00;
    uint8 private constant CALLTYPE_BATCH = 0x01;
    uint8 private constant TRANSFER_FLOW = 0x01;
    uint8 private constant APPROVE_FLOW = 0x02;
    uint48 private constant DAY = 86_400;
    uint48 private constant WEEK = 604_800;
    uint48 private constant MONTH = 2_592_000;
    uint48 private constant FIFTEEN_MINUTES = 900;
    uint48 private constant HOUR = 3_600;
    uint48 private constant TWELVE_HOURS = 43_200;
    uint16 private constant DAY_BUCKET_COUNT = 96;
    uint16 private constant WEEK_BUCKET_COUNT = 168;
    uint16 private constant MONTH_BUCKET_COUNT = 60;

    struct PolicyConfig {
        address token;
        uint256 limit;
        uint48 periodSeconds;
        uint8 flowMask;
        bool initialized;
        address[] allowedCounterparties;
    }

    struct Bucket {
        uint48 bucketStartTimestamp;
        uint208 amount;
    }

    struct Execution {
        address target;
        uint256 value;
        bytes callData;
    }

    struct OutgoingAction {
        address counterparty;
        uint256 amount;
        uint8 flow;
    }

    mapping(address account => uint256 installations) private installationCount;
    mapping(address account => mapping(bytes32 permissionId => PolicyConfig config)) private configs;
    mapping(address account => mapping(bytes32 permissionId => mapping(uint256 slotIndex => Bucket bucket))) private buckets;

    error InvalidInstallData();
    error InvalidPolicyConfig();

    function onInstall(bytes calldata data) external payable override {
        if (data.length <= 32) {
            revert InvalidInstallData();
        }

        bytes32 permissionId = bytes32(data[0:32]);
        (address token, uint256 limit, uint48 periodSeconds, uint8 flowMask, address[] memory allowedCounterparties) =
            abi.decode(data[32:], (address, uint256, uint48, uint8, address[]));

        if (token == address(0) || limit == 0 || flowMask == 0) {
            revert InvalidPolicyConfig();
        }

        _resolveBucketWindow(periodSeconds);

        PolicyConfig storage config = configs[msg.sender][permissionId];
        if (!config.initialized) {
            installationCount[msg.sender] += 1;
        }

        delete config.allowedCounterparties;

        config.token = token;
        config.limit = limit;
        config.periodSeconds = periodSeconds;
        config.flowMask = flowMask;
        config.initialized = true;

        for (uint256 i = 0; i < allowedCounterparties.length; i++) {
            if (allowedCounterparties[i] == address(0)) {
                revert InvalidPolicyConfig();
            }

            config.allowedCounterparties.push(allowedCounterparties[i]);
        }
    }

    function onUninstall(bytes calldata data) external payable override {
        if (data.length < 32) {
            revert InvalidInstallData();
        }

        bytes32 permissionId = bytes32(data[0:32]);
        PolicyConfig storage config = configs[msg.sender][permissionId];

        if (config.initialized && installationCount[msg.sender] > 0) {
            installationCount[msg.sender] -= 1;
        }

        delete configs[msg.sender][permissionId];
    }

    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == 5;
    }

    function isInitialized(address smartAccount) external view override returns (bool) {
        return installationCount[smartAccount] > 0;
    }

    function checkUserOpPolicy(bytes32 id, PackedUserOperation calldata userOp)
        external
        payable
        override
        returns (uint256)
    {
        PolicyConfig storage config = configs[msg.sender][id];

        if (!config.initialized) {
            return 1;
        }

        (bool supported, uint256 amount) = _extractOutgoingAmount(config, userOp.callData);

        if (!supported || amount > type(uint208).max) {
            return 1;
        }

        (uint48 bucketSize, uint16 bucketCount) = _resolveBucketWindow(config.periodSeconds);
        uint48 currentBucketStart = _currentBucketStart(bucketSize);
        uint256 rollingSpent = _sumActiveBuckets(msg.sender, id, currentBucketStart, bucketSize, bucketCount);

        if (rollingSpent + amount > config.limit) {
            return 1;
        }

        if (!_recordOutgoingAmount(msg.sender, id, currentBucketStart, bucketSize, bucketCount, amount)) {
            return 1;
        }

        return 0;
    }

    function checkSignaturePolicy(bytes32 id, address, bytes32, bytes calldata)
        external
        view
        override
        returns (uint256)
    {
        return configs[msg.sender][id].initialized ? 0 : 1;
    }

    function currentWindowSpent(address account, bytes32 permissionId) external view returns (uint256) {
        PolicyConfig storage config = configs[account][permissionId];

        if (!config.initialized) {
            return 0;
        }

        (uint48 bucketSize, uint16 bucketCount) = _resolveBucketWindow(config.periodSeconds);
        uint48 currentBucketStart = _currentBucketStart(bucketSize);
        return _sumActiveBuckets(account, permissionId, currentBucketStart, bucketSize, bucketCount);
    }

    function bucketAmountAt(address account, bytes32 permissionId, uint48 bucketStartTimestamp) external view returns (uint256) {
        PolicyConfig storage config = configs[account][permissionId];

        if (!config.initialized) {
            return 0;
        }

        (uint48 bucketSize, uint16 bucketCount) = _resolveBucketWindow(config.periodSeconds);

        if (bucketStartTimestamp % bucketSize != 0) {
            return 0;
        }

        uint256 slotIndex = _slotIndex(bucketStartTimestamp, bucketSize, bucketCount);
        Bucket storage bucket = buckets[account][permissionId][slotIndex];
        return bucket.bucketStartTimestamp == bucketStartTimestamp ? bucket.amount : 0;
    }

    function _extractOutgoingAmount(PolicyConfig storage config, bytes calldata accountCallData)
        private
        view
        returns (bool supported, uint256 amount)
    {
        if (accountCallData.length < 4) {
            return (false, 0);
        }

        bytes calldata executeCallData;
        bytes4 selector = bytes4(accountCallData[0:4]);

        if (selector == EXECUTE_SELECTOR) {
            executeCallData = accountCallData[4:];
        } else if (selector == EXECUTE_USER_OP_SELECTOR) {
            if (accountCallData.length < 8 || bytes4(accountCallData[4:8]) != EXECUTE_SELECTOR) {
                return (false, 0);
            }
            executeCallData = accountCallData[8:];
        } else {
            return (false, 0);
        }

        (bytes32 execMode, bytes memory executionCalldata) = abi.decode(executeCallData, (bytes32, bytes));
        uint8 callType = uint8(bytes1(execMode));

        if (callType == CALLTYPE_SINGLE) {
            return _extractSingleExecutionOutgoingAmount(config, executionCalldata);
        }

        if (callType == CALLTYPE_BATCH) {
            return _extractBatchExecutionOutgoingAmount(config, executionCalldata);
        }

        return (false, 0);
    }

    function _extractSingleExecutionOutgoingAmount(PolicyConfig storage config, bytes memory executionCalldata)
        private
        view
        returns (bool supported, uint256 amount)
    {
        if (executionCalldata.length < 56) {
            return (false, 0);
        }

        address target;
        uint256 value;
        bytes memory tokenCallData;

        assembly {
            target := shr(96, mload(add(executionCalldata, 32)))
            value := mload(add(executionCalldata, 52))
        }

        tokenCallData = new bytes(executionCalldata.length - 52);
        for (uint256 i = 52; i < executionCalldata.length; i++) {
            tokenCallData[i - 52] = executionCalldata[i];
        }

        return _extractTokenOutgoingAmount(config, target, value, tokenCallData);
    }

    function _extractBatchExecutionOutgoingAmount(PolicyConfig storage config, bytes memory executionCalldata)
        private
        view
        returns (bool supported, uint256 amount)
    {
        Execution[] memory executions = abi.decode(executionCalldata, (Execution[]));

        if (executions.length == 0) {
            return (false, 0);
        }

        uint256 totalAmount = 0;

        for (uint256 i = 0; i < executions.length; i++) {
            (bool isSupported, uint256 executionAmount) =
                _extractTokenOutgoingAmount(config, executions[i].target, executions[i].value, executions[i].callData);

            if (!isSupported) {
                return (false, 0);
            }

            totalAmount += executionAmount;
        }

        return (true, totalAmount);
    }

    function _extractTokenOutgoingAmount(
        PolicyConfig storage config,
        address target,
        uint256 value,
        bytes memory tokenCallData
    ) private view returns (bool supported, uint256 amount) {
        if (target != config.token || value != 0 || tokenCallData.length < 68) {
            return (false, 0);
        }

        OutgoingAction memory action;
        bytes4 selector;
        assembly {
            selector := mload(add(tokenCallData, 32))
        }

        if (selector == ERC20_TRANSFER_SELECTOR) {
            if ((config.flowMask & TRANSFER_FLOW) == 0) {
                return (false, 0);
            }

            (action.counterparty, action.amount) = abi.decode(_slice(tokenCallData, 4), (address, uint256));
            action.flow = TRANSFER_FLOW;
        } else if (selector == ERC20_APPROVE_SELECTOR) {
            if ((config.flowMask & APPROVE_FLOW) == 0) {
                return (false, 0);
            }

            (action.counterparty, action.amount) = abi.decode(_slice(tokenCallData, 4), (address, uint256));
            action.flow = APPROVE_FLOW;
        } else {
            return (false, 0);
        }

        if (!_isAllowedCounterparty(config, action.counterparty)) {
            return (false, 0);
        }

        return (true, action.amount);
    }

    function _isAllowedCounterparty(PolicyConfig storage config, address counterparty) private view returns (bool) {
        if (counterparty == address(0)) {
            return false;
        }

        if (config.allowedCounterparties.length == 0) {
            return true;
        }

        for (uint256 i = 0; i < config.allowedCounterparties.length; i++) {
            if (config.allowedCounterparties[i] == counterparty) {
                return true;
            }
        }

        return false;
    }

    function _resolveBucketWindow(uint48 periodSeconds) private pure returns (uint48 bucketSize, uint16 bucketCount) {
        if (periodSeconds == DAY) {
            return (FIFTEEN_MINUTES, DAY_BUCKET_COUNT);
        }

        if (periodSeconds == WEEK) {
            return (HOUR, WEEK_BUCKET_COUNT);
        }

        if (periodSeconds == MONTH) {
            return (TWELVE_HOURS, MONTH_BUCKET_COUNT);
        }

        revert InvalidPolicyConfig();
    }

    function _currentBucketStart(uint48 bucketSize) private view returns (uint48) {
        return uint48((block.timestamp / bucketSize) * bucketSize);
    }

    function _slotIndex(uint48 bucketStartTimestamp, uint48 bucketSize, uint16 bucketCount) private pure returns (uint256) {
        return (uint256(bucketStartTimestamp) / bucketSize) % bucketCount;
    }

    function _sumActiveBuckets(
        address account,
        bytes32 permissionId,
        uint48 currentBucketStart,
        uint48 bucketSize,
        uint16 bucketCount
    ) private view returns (uint256 totalSpent) {
        uint256 span = uint256(bucketSize) * uint256(bucketCount - 1);
        uint256 windowStart = uint256(currentBucketStart) > span ? uint256(currentBucketStart) - span : 0;

        for (uint256 i = 0; i < bucketCount; i++) {
            Bucket storage bucket = buckets[account][permissionId][i];
            uint48 bucketStartTimestamp = bucket.bucketStartTimestamp;

            if (bucketStartTimestamp < windowStart || bucketStartTimestamp > currentBucketStart) {
                continue;
            }

            totalSpent += bucket.amount;
        }
    }

    function _recordOutgoingAmount(
        address account,
        bytes32 permissionId,
        uint48 currentBucketStart,
        uint48 bucketSize,
        uint16 bucketCount,
        uint256 amount
    ) private returns (bool) {
        uint256 slotIndex = _slotIndex(currentBucketStart, bucketSize, bucketCount);
        Bucket storage bucket = buckets[account][permissionId][slotIndex];

        if (bucket.bucketStartTimestamp != currentBucketStart) {
            bucket.bucketStartTimestamp = currentBucketStart;
            bucket.amount = uint208(amount);
            return true;
        }

        if (bucket.amount > type(uint208).max - amount) {
            return false;
        }

        bucket.amount += uint208(amount);
        return true;
    }

    function _slice(bytes memory data, uint256 start) private pure returns (bytes memory result) {
        if (start > data.length) {
            return new bytes(0);
        }

        result = new bytes(data.length - start);
        for (uint256 i = start; i < data.length; i++) {
            result[i - start] = data[i];
        }
    }
}
