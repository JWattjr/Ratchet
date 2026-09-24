import { studioDevnet, studionet } from "genlayer-js/chains";
import type { GenLayerChain } from "genlayer-js/types";
import deployment from "./deployment.json";

export type RatchetNetwork = "studioDevnet" | "studionet";
const configuredNetwork = process.env.NEXT_PUBLIC_RATCHET_NETWORK?.trim() || deployment.network;
export const NETWORK: RatchetNetwork = configuredNetwork === "studionet" ? "studionet" : "studioDevnet";
export const chain: GenLayerChain = NETWORK === "studionet" ? studionet : studioDevnet;
export const NETWORK_LABEL = NETWORK === "studionet" ? "Studionet" : "Studio Next";
export const CHAIN_ID = chain.id;
export const RPC_URL = chain.rpcUrls.default.http[0];
export const EXPLORER_URL = chain.blockExplorers?.default?.url?.replace(/\/$/, "") ?? "https://explorer-studio-dev.genlayer.com";
const configuredAddress = process.env.NEXT_PUBLIC_RATCHET_ADDRESS?.trim() || (
  deployment.network === NETWORK && deployment.chainId === CHAIN_ID ? deployment.contract : ""
);
export const CONTRACT_ADDRESS = /^0x[0-9a-fA-F]{40}$/.test(configuredAddress) ? configuredAddress as `0x${string}` : "";

export function explorerTx(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${EXPLORER_URL}/address/${address}`;
}
