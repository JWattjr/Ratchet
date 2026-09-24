require("@nomicfoundation/hardhat-ethers");

const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, _hre, runSuper) => {
  if (solcVersion === "0.8.30") {
    const solc = require("solc");
    return {
      compilerPath: require.resolve("solc/soljson.js"),
      isSolcJs: true,
      version: "0.8.30",
      longVersion: solc.version(),
    };
  }
  return runSuper();
});

module.exports = {
  solidity: {
    version: "0.8.30",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata", "storageLayout"] } },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      initialDate: "2026-09-23T00:00:00.000Z",
      allowBlocksWithSameTimestamp: true,
      throwOnCallFailures: false,
      throwOnTransactionFailures: false,
    },
  },
  paths: {
    sources: "./replay/contracts",
    cache: "./replay/cache",
    artifacts: "./replay/artifacts",
  },
};
