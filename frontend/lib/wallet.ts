export type InjectedProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}

export function getInjectedProvider(): InjectedProvider | null {
  return typeof window !== "undefined" ? window.ethereum ?? null : null;
}

export async function connectWallet(provider: InjectedProvider): Promise<string> {
  const result = await provider.request({ method: "eth_requestAccounts" });
  const address = Array.isArray(result) ? result[0] : null;
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error("No wallet account is available. Unlock your wallet and try again.");
  }
  return address;
}

export const STUDIO_CHAIN = {
  id: 61997,
  name: "GenLayer Studio Next",
  rpc: "https://studio-dev.genlayer.com/api",
  explorer: "https://explorer-studio-dev.genlayer.com",
  currency: { name: "GEN", symbol: "GEN", decimals: 18 },
} as const;

function isUnknownChain(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; data?: unknown; originalError?: unknown };
  return Number(record.code) === 4902 || isUnknownChain(record.data) || isUnknownChain(record.originalError);
}

export async function ensureStudioChain(provider: InjectedProvider): Promise<void> {
  const chainId = `0x${STUDIO_CHAIN.id.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    if (!isUnknownChain(error)) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId,
        chainName: STUDIO_CHAIN.name,
        nativeCurrency: STUDIO_CHAIN.currency,
        rpcUrls: [STUDIO_CHAIN.rpc],
        blockExplorerUrls: [STUDIO_CHAIN.explorer],
      }],
    });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  }
}

export function guardedProvider(provider: InjectedProvider, account: string): InjectedProvider {
  return {
    request: async (request) => {
      if (request.method === "eth_sendTransaction" || request.method === "eth_signTransaction") {
        const chain = await provider.request({ method: "eth_chainId" });
        if (typeof chain !== "string" || BigInt(chain) !== BigInt(STUDIO_CHAIN.id)) {
          throw new Error(`Switch your wallet to ${STUDIO_CHAIN.name} (chain ${STUDIO_CHAIN.id}) before signing.`);
        }
        const accounts = await provider.request({ method: "eth_accounts" });
        const current = Array.isArray(accounts) ? accounts[0] : null;
        if (typeof current !== "string" || current.toLowerCase() !== account.toLowerCase()) {
          throw new Error("The wallet account changed. Reconnect before sending.");
        }
      }
      return provider.request(request);
    },
  };
}

export function readableError(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as { code?: unknown; shortMessage?: unknown; message?: unknown; details?: unknown; cause?: { message?: unknown } };
    if (Number(record.code) === 4001) return "The request was declined in your wallet.";
    const reason = [record.details, record.cause?.message, record.message].filter((part): part is string => typeof part === "string").join(" ");
    if (/rate limit exceeded|too many requests|retry_after_seconds/i.test(reason)) {
      return "Studio Next has reached its RPC request limit. Wait for the limit to reset, then refresh the live read.";
    }
    if (typeof record.shortMessage === "string" && record.shortMessage) return record.shortMessage;
    if (typeof record.message === "string" && record.message) return record.message.split("\n")[0].slice(0, 280);
  }
  return typeof error === "string" && error ? error : "The action could not be completed.";
}
