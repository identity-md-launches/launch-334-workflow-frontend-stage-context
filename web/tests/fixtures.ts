import type { Page } from '@playwright/test';
import { decodeFunctionData, encodeFunctionResult, encodeErrorResult, parseEther, toHex, type Abi, type Address, type Hex } from 'viem';
import appAbiJson from '../public/abi/SavingsCircle.json' with { type: "json" };
import tokenAbiJson from '../public/abi/LaunchToken.json' with { type: "json" };
import handoff from '../config/handoff.json' with { type: "json" };
export const account = '0x1000000000000000000000000000000000000001' as Address;
const other = '0x2000000000000000000000000000000000000002' as Address;
const token = handoff.contracts.find(c => c.name === 'LaunchToken')!;
const app = handoff.contracts.find(c => c.name === 'SavingsCircle')!;
const appAbi = appAbiJson as Abi, tokenAbi = tokenAbiJson as Abi;
export const timestamp = 1800000000n;
const hash = `0x${'1'.repeat(64)}` as Hex;
const blockHash = `0x${'2'.repeat(64)}`;
export type MockState = { allowance: bigint; balance: bigint; withdrawable: bigint; state: number; joined: bigint; count: bigint; currentRound: bigint; nextRound: bigint; start: bigint; createdAt: bigint; paid: bigint; inDefault: boolean; member: Address; missingCode: boolean; rpcFail: boolean; simulationError: boolean; receiptFailed: boolean; readChain: number; sent: { functionName: string; args: readonly unknown[] }[] };
export async function fixture(page: Page, options: { connected?: boolean; wrongChain?: boolean; wallet?: boolean; state?: Partial<MockState> } = {}) {
  const s: MockState = { allowance: 0n, balance: parseEther('1000'), withdrawable: parseEther('12'), state: 0, joined: 1n, count: 1n, currentRound: 0n, nextRound: 0n, start: timestamp - 3600n, createdAt: timestamp - 1000n, paid: 0n, inDefault: false, member: other, missingCode: false, rpcFail: false, simulationError: false, receiptFailed: false, readChain: handoff.chainId, sent: [], ...options.state };
  await page.exposeFunction('mockSend', (data: Hex, to: string) => {
    const decoded = decodeFunctionData({ abi: to.toLowerCase() === token.address ? tokenAbi : appAbi, data });
    s.sent.push({ functionName: decoded.functionName, args: decoded.args ?? [] });
    if (decoded.functionName === 'approve') s.allowance = decoded.args![1] as bigint;
    if (decoded.functionName === 'create') { s.count += 1n; s.balance -= parseEther('30'); s.allowance -= parseEther('30'); }
    if (decoded.functionName === 'join') { s.joined = 2n; s.member = account; s.balance -= parseEther('30'); s.allowance -= parseEther('30'); }
    if (decoded.functionName === 'contribute') { s.paid |= 1n << s.currentRound; s.allowance -= parseEther('10'); s.balance -= parseEther('10'); }
    if (decoded.functionName === 'closeRound') s.nextRound += 1n;
    if (decoded.functionName === 'cancel') s.state = 2;
    if (decoded.functionName === 'withdraw') s.withdrawable = 0n;
    return hash;
  });
  if (options.wallet !== false) await page.addInitScript(({ account, connected, wrongChain, chainId }) => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    const state = { connected, chain: wrongChain ? '0x1' : chainId, added: false, reject: false, rejectSwitch: false, requests: [] as { method: string; params: unknown }[], listeners };
    const win = window as unknown as { mockWallet: typeof state; mockSend: (data: string, to: string) => Promise<string>; ethereum: unknown };
    win.mockWallet = state;
    win.ethereum = {
      on: (event: string, fn: (...args: unknown[]) => void) => (listeners[event] ??= []).push(fn),
      removeListener: (event: string, fn: (...args: unknown[]) => void) => { listeners[event] = listeners[event]?.filter(x => x !== fn); },
      request: async ({ method, params }: { method: string; params: Record<string, string>[] }) => {
        state.requests.push({ method, params });
        if (method === 'eth_accounts') return state.connected ? [account] : [];
        if (method === 'eth_chainId') return state.chain;
        if (method === 'eth_requestAccounts') { if (state.reject) throw { code: 4001, message: 'User rejected' }; state.connected = true; return [account]; }
        if (method === 'wallet_switchEthereumChain') { if (state.rejectSwitch) throw { code: 4001, message: 'User rejected' }; if (!state.added) throw { code: 4902, message: 'Unknown chain' }; state.chain = chainId; listeners.chainChanged?.forEach(fn => fn(chainId)); return null; }
        if (method === 'wallet_addEthereumChain') { state.added = true; return null; }
        if (method === 'eth_sendTransaction') { if (state.reject) throw { code: 4001, message: 'User rejected' }; return win.mockSend(params[0].data, params[0].to); }
        throw Error(`Unexpected wallet method ${method}`);
      },
    };
  }, { account, connected: options.connected ?? true, wrongChain: options.wrongChain ?? false, chainId: toHex(handoff.chainId) });
  const result = async (rpc: { id: number; method: string; params: any[] }) => {
    let value: unknown;
    if (s.rpcFail) return { jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: 'Mock RPC unavailable' } };
    switch (rpc.method) {
      case 'eth_chainId': value = toHex(s.readChain); break;
      case 'eth_blockNumber': value = '0xb40000'; break;
      case 'eth_getCode': value = s.missingCode ? '0x' : '0x60006000'; break;
      case 'eth_getBlockByNumber': value = { number: '0xb40000', hash: blockHash, parentHash: hash, timestamp: toHex(timestamp), gasLimit: '0x1c9c380', gasUsed: '0x0', baseFeePerGas: '0x1', difficulty: '0x0', extraData: '0x', miner: account, nonce: '0x0000000000000000', size: '0x100', totalDifficulty: '0x0', transactions: [], uncles: [], logsBloom: `0x${'0'.repeat(512)}`, receiptsRoot: hash, sha3Uncles: hash, stateRoot: hash, transactionsRoot: hash, mixHash: hash }; break;
      case 'eth_getTransactionReceipt': value = { transactionHash: hash, blockHash, blockNumber: '0xb40000', transactionIndex: '0x0', from: account, to: app.address, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', contractAddress: null, logs: [], logsBloom: `0x${'0'.repeat(512)}`, status: s.receiptFailed ? '0x0' : '0x1', effectiveGasPrice: '0x1', type: '0x2' }; break;
      case 'eth_call': {
        const call = rpc.params[0];
        const abi = call.to.toLowerCase() === token.address ? tokenAbi : appAbi;
        const { functionName, args } = decodeFunctionData({ abi, data: call.data });
        const views: Record<string, unknown> = {
          token: token.address, decimals: 18, MIN_CONTRIBUTION: parseEther('1'), MIN_ROUND_LENGTH: 3600n, MAX_ROUND_LENGTH: 2592000n, JOIN_PERIOD: 604800n,
          circleCount: s.count, balanceOf: s.balance, allowance: s.allowance, withdrawable: s.withdrawable,
          circle: { contribution: parseEther('10'), roundLength: 3600n, seats: 4n, joined: s.joined, createdAt: s.createdAt, start: s.start, nextRound: s.nextRound, bondsHeld: parseEther('30'), openPots: parseEther('10'), carry: 0n, state: s.state },
          member: args?.[1] === 0n ? s.member : `0x${(BigInt(other) + ((args?.[1] as bigint) ?? 0n)).toString(16).padStart(40, '0')}`, inDefault: s.inDefault, paidRounds: args?.[1] === s.member ? s.paid : 3n, currentRound: s.currentRound, roundPot: parseEther('10'),
        };
        if (Object.hasOwn(views, functionName)) value = encodeFunctionResult({ abi, functionName, result: views[functionName] });
        else if (s.simulationError) return { jsonrpc: '2.0', id: rpc.id, error: { code: 3, message: 'execution reverted', data: encodeErrorResult({ abi: appAbi, errorName: 'RoundNotEnded' }) } };
        else value = functionName === 'approve' ? encodeFunctionResult({ abi, functionName, result: true }) : functionName === 'create' ? encodeFunctionResult({ abi, functionName, result: s.count }) : '0x';
        break;
      }
      default: throw Error(`Unexpected RPC ${rpc.method}`);
    }
    return { jsonrpc: '2.0', id: rpc.id, result: value };
  };
  await page.route(/https:\/\/(ethereum-sepolia-rpc\.publicnode\.com|rpc\.sepolia\.ethpandaops\.io|sepolia\.rpc\.sentio\.xyz)\/?$/, async route => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: Array.isArray(body) ? await Promise.all(body.map(result)) : await result(body) });
  });
  return s;
}
