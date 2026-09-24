// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./VaultV1.sol";

/// @notice Unsafe demonstration candidate: withdraws funds without reducing liabilities.
contract VaultV2InvariantBreak is VaultV1 {
    function withdraw(uint256 amount) public override {
        require(amount > 0 && balances[msg.sender] >= amount, "WITHDRAWAL_BOUND");
        balances[msg.sender] -= amount;
        // Deliberate demonstration defect: totalDeposits is not reduced.
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "TRANSFER_FAILED");
        emit Withdrawn(msg.sender, msg.sender, amount);
    }
}
