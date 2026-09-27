import { createPublicClient, custom, defineChain, fallback, http, isAddress, keccak256, stringToHex, type Abi, type Address, type EIP1193Provider, type Transport } from 'viem';

export type Provider = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
declare global { interface Window { ethereum?: Provider } }
export type Deployment = {
  version: number; launchId: string; chainId: number; sourceCommit: string; attestationHash: string;
  contracts: { name: string; address: Address; abiHash: string; abiPath: string }[];
  network: { chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string; nativeCurrency: { name: string; symbol: string; decimals: number }; faucets: string[]; uniswapV4: Record<string, Address> };
  walletAddChain: { chainId: string; chainName: string; rpcUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[] };
};
export type Runtime = Awaited<ReturnType<typeof loadRuntime>>;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}
async function json(path: string) {
  const result = await fetch(new URL(path, new URL('./', location.href)), { cache: 'no-cache' });
  if (!result.ok) throw Error(`Unable to load ${path}. Reload the page or check the static export.`);
  return result.json();
}
export async function loadRuntime() {
  const deployment = await json('imd-deployment.json') as Deployment;
  if (deployment.version !== 1 || deployment.chainId !== deployment.network?.chainId || !Number.isSafeInteger(deployment.chainId) || BigInt(deployment.walletAddChain.chainId) !== BigInt(deployment.chainId)) throw Error('Deployment network does not match. Transactions are disabled.');
  const bindings = await Promise.all(deployment.contracts.map(async c => {
    if (!isAddress(c.address) || !/^abi\/[A-Za-z0-9_]+\.json$/.test(c.abiPath)) throw Error('Invalid deployment contract binding.');
    const abi = await json(c.abiPath) as Abi;
    if (!Array.isArray(abi) || keccak256(stringToHex(JSON.stringify(canonical(abi)))).slice(2) !== c.abiHash) throw Error(`ABI verification failed for ${c.name}.`);
    return { ...c, abi };
  }));
  const app = bindings.find(c => c.name === 'SavingsCircle');
  const token = bindings.find(c => c.name === 'LaunchToken');
  if (!app || !token || bindings.length !== 2) throw Error('Required deployment contracts are missing or duplicated.');
  const chain = defineChain({ id: deployment.chainId, name: deployment.network.name, nativeCurrency: deployment.network.nativeCurrency, rpcUrls: { default: { http: deployment.network.rpcUrls } }, blockExplorers: { default: { name: 'Explorer', url: deployment.network.explorer } }, testnet: deployment.network.testnet });
  return { deployment, app, token, chain };
}
export function readClient(runtime: Runtime, provider?: Provider, walletChain?: number) {
  const transports: Transport[] = runtime.deployment.network.rpcUrls.map(url => http(url, { timeout: 8000, retryCount: 0, batch: true }));
  if (provider && walletChain === runtime.chain.id) transports.push(custom(provider, { retryCount: 0 }));
  return createPublicClient({ chain: runtime.chain, transport: fallback(transports, { rank: false, retryCount: 0 }) });
}
export async function switchNetwork(provider: Provider, runtime: Runtime) {
  const chainId = runtime.deployment.walletAddChain.chainId as `0x${string}`;
  try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
  catch (error) {
    const e = error as { code?: number; message?: string };
    if (e.code !== 4902 && !/unknown chain|unrecognized chain|not added/i.test(e.message || '')) throw error;
    await provider.request({ method: 'wallet_addEthereumChain', params: [{ ...runtime.deployment.walletAddChain, chainId }] });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  }
}
