import { readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, http } from 'viem';
const handoff = JSON.parse(await readFile(new URL('../config/handoff.json', import.meta.url)));
const { network } = JSON.parse(await readFile(new URL('../config/network.json', import.meta.url)));
const idx = process.argv.indexOf('--rpc');
const rpc = idx >= 0 ? process.argv[idx + 1] : network.rpcUrls[0];
const client = createPublicClient({ transport: http(rpc, { retryCount: 0, timeout: 15000 }) });
const chainId = await client.getChainId();
if (chainId !== handoff.chainId) throw Error('RPC chain mismatch');
const latest = await client.getBlock();
const result = { checkedAt: new Date().toISOString(), chainId, sourceCommit: handoff.sourceCommit, latest: { number: String(latest.number), hash: latest.hash }, contracts: [] };
for (const c of handoff.contracts) {
  const abi = JSON.parse(await readFile(new URL(`../public/abi/${c.name}.json`, import.meta.url)));
  const pin = await client.getBlock({ blockNumber: BigInt(c.blockNumber) });
  const pinnedCode = await client.getCode({ address: c.address, blockNumber: pin.number });
  const code = await client.getCode({ address: c.address, blockNumber: latest.number });
  if (!code || code === '0x' || !pinnedCode || pinnedCode === '0x') throw Error('Missing deployment code');
  const views = {};
  for (const name of c.name === 'SavingsCircle' ? ['token', 'circleCount', 'accountedBalance'] : ['decimals', 'symbol', 'totalSupply']) {
    views[name] = String(await client.readContract({ address: c.address, abi, functionName: name, blockNumber: latest.number }));
  }
  result.contracts.push({ name: c.name, address: c.address, pinnedBlock: { number: String(pin.number), hash: pin.hash }, pinnedCodeBytes: (pinnedCode.length - 2) / 2, latestCodeBytes: (code.length - 2) / 2, views });
}
if (result.contracts.find(c => c.name === 'SavingsCircle').views.token.toLowerCase() !== handoff.contracts.find(c => c.name === 'LaunchToken').address.toLowerCase()) throw Error('Token mismatch');
await writeFile(new URL('../../docs/frontend/live-chain.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log('Read-only chain verification passed; evidence: docs/frontend/live-chain.json');
