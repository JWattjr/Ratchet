// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Tiny local-EVM protocol used only to demonstrate differential replay.
contract VaultV1 {
    address public immutable owner;
    uint256 public totalDeposits;
    mapping(address => uint256) public balances;

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, address indexed recipient, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "OWNER_ONLY");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function deposit() external payable {
        require(msg.value > 0, "ZERO_DEPOSIT");
        balances[msg.sender] += msg.value;
        totalDeposits += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) public virtual {
        require(amount > 0 && balances[msg.sender] >= amount, "WITHDRAWAL_BOUND");
        balances[msg.sender] -= amount;
        totalDeposits -= amount;
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "TRANSFER_FAILED");
        emit Withdrawn(msg.sender, msg.sender, amount);
    }
}
