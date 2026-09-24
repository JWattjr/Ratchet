// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./VaultV1.sol";

/// @notice Honest candidate: adds the declared owner-controlled emergency pause.
contract VaultV2Declared is VaultV1 {
    bool public paused;

    event PauseChanged(bool paused);

    function setPaused(bool next) external onlyOwner {
        paused = next;
        emit PauseChanged(next);
    }

    function withdraw(uint256 amount) public override {
        require(!paused, "VAULT_PAUSED");
        super.withdraw(amount);
    }
}
