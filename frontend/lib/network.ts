import { studioDevnet } from "genlayer-js/chains";
import type { GenLayerChain } from "genlayer-js/types";
import deployment from "./deployment.json";

export const chain: GenLayerChain = studioDevnet;
export const CHAIN_ID = 61997;
export const RPC_URL = "https://studio-dev.genlayer.com/api";
export const EXPLORER_URL = "https://explorer-studio-dev.genlayer.com";
const configuredAddress = process.env.NEXT_PUBLIC_RATCHET_ADDRESS?.trim() || (
  deployment.network === "studioDevnet" && deployment.chainId === CHAIN_ID ? deployment.contract : ""
);
export const CONTRACT_ADDRESS = /^0x[0-9a-fA-F]{40}$/.test(configuredAddress) ? configuredAddress as `0x${string}` : "";

export function explorerTx(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${EXPLORER_URL}/address/${address}`;
}
