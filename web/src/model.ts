import { BaseError, ContractFunctionRevertedError, formatUnits, maxUint256, parseUnits, type Address } from 'viem';
import { readClient, type Runtime } from './config';
export type Circle = { contribution: bigint; roundLength: bigint; seats: bigint; joined: bigint; createdAt: bigint; start: bigint; nextRound: bigint; bondsHeld: bigint; openPots: bigint; carry: bigint; state: number };
export type Member = { address: Address; inDefault: boolean; paid: bigint };
export type Detail = { id: bigint; circle: Circle; members: Member[]; currentRound: bigint; pot: bigint; nextPot: bigint };
export type Snapshot = { block: bigint; timestamp: bigint; loadedAt: number; count: bigint; circles: { id: bigint; circle: Circle }[]; detail?: Detail; decimals: number; balance: bigint; allowance: bigint; withdrawable: bigint; minContribution: bigint; minRound: bigint; maxRound: bigint; joinPeriod: bigint; account?: Address };
export type Client = ReturnType<typeof readClient>;
export async function readSnapshot(runtime: Runtime, client: Client, account: Address | undefined, offset: bigint, selected?: bigint): Promise<Snapshot> {
  if (await client.getChainId() !== runtime.chain.id) throw Error('RPC returned the wrong network. Retry with a working configured RPC.');
  const block = await client.getBlock();
  const codes = await Promise.all([runtime.app, runtime.token].map(c => client.getCode({ address: c.address, blockNumber: block.number })));
  if (codes.some(c => !c || c === '0x')) throw Error('Deployed contract code is missing. Transactions are disabled.');
  const appRead = (functionName: string, args?: readonly unknown[]) => client.readContract({ address: runtime.app.address, abi: runtime.app.abi, functionName, args, blockNumber: block.number });
  const tokenAddress = await appRead('token') as Address;
  if (tokenAddress.toLowerCase() !== runtime.token.address.toLowerCase()) throw Error('SavingsCircle.token() does not match the attested CIRC address.');
  const tokenRead = (functionName: string, args?: readonly unknown[]) => client.readContract({ address: tokenAddress, abi: runtime.token.abi, functionName, args, blockNumber: block.number });
  const [count, decimals, minContribution, minRound, maxRound, joinPeriod, balance, allowance, withdrawable] = await Promise.all([
    appRead('circleCount'), tokenRead('decimals'), appRead('MIN_CONTRIBUTION'), appRead('MIN_ROUND_LENGTH'), appRead('MAX_ROUND_LENGTH'), appRead('JOIN_PERIOD'),
    account ? tokenRead('balanceOf', [account]) : 0n, account ? tokenRead('allowance', [account, runtime.app.address]) : 0n, account ? appRead('withdrawable', [account]) : 0n,
  ]) as [bigint, number, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
  const circles = await Promise.all(Array.from({ length: Number(count > offset ? (count - offset > 6n ? 6n : count - offset) : 0n) }, async (_, i) => {
    const id = offset + BigInt(i);
    return { id, circle: await appRead('circle', [id]) as Circle };
  }));
  let detail: Detail | undefined;
  if (selected !== undefined && selected < count) {
    const circle = circles.find(c => c.id === selected)?.circle ?? await appRead('circle', [selected]) as Circle;
    const currentRound = await appRead('currentRound', [selected]) as bigint;
    const members = await Promise.all(Array.from({ length: Number(circle.joined) }, async (_, seat) => {
      const address = await appRead('member', [selected, BigInt(seat)]) as Address;
      const [inDefault, paid] = await Promise.all([appRead('inDefault', [selected, address]), appRead('paidRounds', [selected, address])]);
      return { address, inDefault: inDefault as boolean, paid: paid as bigint };
    }));
    const pot = currentRound < circle.seats ? await appRead('roundPot', [selected, currentRound]) as bigint : 0n;
    const nextPot = circle.nextRound < circle.seats ? await appRead('roundPot', [selected, circle.nextRound]) as bigint : 0n;
    detail = { id: selected, circle, currentRound, members, pot, nextPot };
  }
  return { block: block.number, timestamp: block.timestamp, loadedAt: Date.now(), count, circles, detail, decimals, balance, allowance, withdrawable, minContribution, minRound, maxRound, joinPeriod, account };
}
export const units = (amount: bigint, decimals: number) => formatUnits(amount, decimals);
export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
export const date = (timestamp: bigint) => new Date(Number(timestamp) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const states = ['Open for members', 'Active', 'Cancelled', 'Completed'];
export function createValues(amount: string, hours: string, seats: string, snapshot?: Snapshot) {
  const decimals = snapshot?.decimals ?? 18;
  if (!/^\d+(\.\d+)?$/.test(amount) || (amount.split('.')[1]?.length ?? 0) > decimals) return { field: 'contribution', error: `Enter a CIRC amount with at most ${decimals} decimal places.` };
  const contribution = parseUnits(amount, decimals);
  if (contribution < (snapshot?.minContribution ?? 10n ** BigInt(decimals))) return { field: 'contribution', error: 'Contribution must be at least 1 CIRC.' };
  if (!/^\d+$/.test(hours) || BigInt(hours) * 3600n < (snapshot?.minRound ?? 3600n) || BigInt(hours) * 3600n > (snapshot?.maxRound ?? 2592000n)) return { field: 'hours', error: 'Round length must be a whole number from 1 to 720 hours.' };
  if (!/^\d+$/.test(seats) || BigInt(seats) < 2n || BigInt(seats) > 10n) return { field: 'seats', error: 'Choose between 2 and 10 seats.' };
  const bond = contribution * (BigInt(seats) - 1n);
  if (bond > maxUint256) return { field: 'contribution', error: 'Contribution is too large for the contract.' };
  return { contribution, roundLength: BigInt(hours) * 3600n, seats: BigInt(seats), bond };
}
export function eligibility(detail: Detail, snapshot: Snapshot, account?: Address) {
  const c = detail.circle;
  const self = detail.members.find(m => m.address.toLowerCase() === account?.toLowerCase());
  return {
    self,
    join: c.state === 0 && snapshot.timestamp < c.createdAt + snapshot.joinPeriod && !self && c.joined < c.seats,
    cancel: c.state === 0 && snapshot.timestamp >= c.createdAt + snapshot.joinPeriod,
    contribute: c.state === 1 && detail.currentRound < c.seats && !!self && !self.inDefault && (self.paid & (1n << detail.currentRound)) === 0n,
    close: c.state === 1 && c.nextRound < c.seats && snapshot.timestamp >= c.start + (c.nextRound + 1n) * c.roundLength,
  };
}
export function explain(error: unknown) {
  const revert = error instanceof BaseError ? error.walk(cause => cause instanceof ContractFunctionRevertedError) : undefined;
  if (revert instanceof ContractFunctionRevertedError) {
    const name = revert.data?.errorName || revert.reason;
    const hints: Record<string, string> = {
      RoundNotEnded: 'This round has not ended yet.', RoundOutOfOrder: 'Close the next unsettled round first.',
      AlreadyContributed: 'You already paid this round.', MemberInDefault: 'A missed round prevents further contributions.',
      AlreadyMember: 'You already have a seat.', NotMember: 'Only members can contribute.', JoinExpired: 'The joining deadline has passed.',
      WrongState: 'The circle has moved to another stage.', NothingToWithdraw: 'There is no credit to withdraw.',
      CancellationTooEarly: 'Recruitment has not expired.', RoundWindowEnded: 'All contribution windows have ended.',
      ERC20InsufficientAllowance: 'Approve enough CIRC for this payment.', ERC20InsufficientBalance: 'Your CIRC balance is too low.',
    };
    if (name) return `${hints[name] || 'The contract rejected this action.'} (${name}) Refresh the state before retrying.`;
  }
  const e = error as { shortMessage?: string; message?: string; code?: number };
  const text = e.shortMessage || e.message || 'Unknown error';
  if (e.code === 4001 || /rejected|denied/i.test(text)) return 'Request declined in your wallet. No new transaction was submitted. Try again when ready.';
  return `${text.slice(0, 500)} Refresh the state and try again.`;
}
