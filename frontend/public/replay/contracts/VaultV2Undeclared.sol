// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./VaultV1.sol";

/// @notice Unsafe demonstration candidate: adds an undeclared privileged withdrawal.
contract VaultV2Undeclared is VaultV1 {
    event PrivilegedWithdrawal(address indexed account, address indexed recipient, uint256 amount);

    function emergencyWithdraw(address account, address payable recipient, uint256 amount) external onlyOwner {
        require(amount > 0 && balances[account] >= amount, "WITHDRAWAL_BOUND");
        balances[account] -= amount;
        totalDeposits -= amount;
        (bool sent, ) = recipient.call{value: amount}("");
        require(sent, "TRANSFER_FAILED");
        emit PrivilegedWithdrawal(account, recipient, amount);
    }
}

