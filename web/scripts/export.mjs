import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { keccak256, stringToHex } from 'viem';
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = async (p) => JSON.parse(await readFile(path.join(root, p), 'utf8'));
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const hashAbi = abi => keccak256(stringToHex(JSON.stringify(canonical(abi)))).slice(2);
const handoff = await read('web/config/handoff.json');
const { network, walletAddChain } = await read('web/config/network.json');
if (handoff.chainId !== network.chainId || BigInt(walletAddChain.chainId) !== BigInt(network.chainId)) throw Error('Chain binding mismatch');
const target = process.argv.includes('--dev') ? 'web/public' : 'dist';
const verify = process.argv.includes('--verify');
const contracts = [];
for (const c of handoff.contracts) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(c.name)) throw Error('Unsafe contract name');
  const abi = await read(`web/public/abi/${c.name}.json`);
  const pinned = JSON.parse(execFileSync('git', ['show', `${handoff.sourceCommit}:docs/abi/${c.name}.json`], { cwd: root, encoding: 'utf8' }));
  if (!Array.isArray(abi) || hashAbi(abi) !== c.abiHash || hashAbi(pinned) !== c.abiHash || JSON.stringify(abi) !== JSON.stringify(pinned)) throw Error(`ABI mismatch: ${c.name}`);
  contracts.push({ name: c.name, address: c.address, abiHash: c.abiHash, abiPath: `abi/${c.name}.json` });
}
await mkdir(path.join(root, target), { recursive: true });
const inventory = async (dir, prefix = '') => {
  const list = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (relative === 'imd-deployment.json') continue;
    if (entry.isSymbolicLink()) throw Error('Symlinks are not export assets');
    if (entry.isDirectory()) list.push(...await inventory(path.join(dir, entry.name), relative + '/'));
    else {
      const bytes = await readFile(path.join(dir, entry.name));
      if (bytes.length > 8388608) throw Error('Asset exceeds 8 MiB');
      list.push({ path: relative, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  return list.sort((a,b) => a.path.localeCompare(b.path));
};
const assets = await inventory(path.join(root, target));
const totalBytes = (await Promise.all(assets.map(a => readFile(path.join(root, target, a.path))))).reduce((n, b) => n + b.length, 0);
if (totalBytes > 6 * 1024 * 1024) throw Error('Export exceeds the 6 MiB task allocation');
if (assets.length > 128) throw Error('Too many export assets');
const manifest = { version: 1, launchId: handoff.launchId, chainId: handoff.chainId, sourceCommit: handoff.sourceCommit, attestationHash: handoff.attestationHash, contracts, assets, network, walletAddChain };
if (verify) {
  const actual = await read('dist/imd-deployment.json');
  if (JSON.stringify(actual) !== JSON.stringify(manifest)) throw Error('Export inventory or deployment changed');
} else await writeFile(path.join(root, target, 'imd-deployment.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${verify ? 'Verified' : 'Wrote'} ${target}/imd-deployment.json: ${assets.length} assets, both pinned ABI hashes match.`);
