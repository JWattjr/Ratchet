import { studionet } from "genlayer-js/chains";
import deployment from "./deployment.json";

const configuredNetwork = process.env.NEXT_PUBLIC_RATCHET_NETWORK?.trim();
if (configuredNetwork && configuredNetwork !== "studionet") {
  throw new Error("Ratchet's active deployment target is Studionet. Set NEXT_PUBLIC_RATCHET_NETWORK=studionet.");
}
export const NETWORK = "studionet";
export const chain = studionet;
export const NETWORK_LABEL = "Studionet";
export const CHAIN_ID = chain.id;
export const RPC_URL = chain.rpcUrls.default.http[0];
export const EXPLORER_URL = chain.blockExplorers?.default?.url?.replace(/\/$/, "") ?? "https://genlayer-explorer.vercel.app";
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
