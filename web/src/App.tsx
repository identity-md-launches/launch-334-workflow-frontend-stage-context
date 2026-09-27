import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createWalletClient, custom, type Address, type Hash } from 'viem';
import { loadRuntime, readClient, switchNetwork, type Runtime } from './config';
import { createValues, date, eligibility, explain, readSnapshot, short, states, units, type Snapshot } from './model';

function Mark() { return <span className="mark" aria-hidden="true"><span /><span /><span /></span>; }
function Stat({ label, children }: { label: string; children: ReactNode }) { return <div className="stat"><dt>{label}</dt><dd>{children}</dd></div>; }
function AddressLink({ runtime, address, children }: { runtime: Runtime; address: Address; children?: ReactNode }) {
  return <a href={`${runtime.deployment.network.explorer}/address/${address}`} target="_blank" rel="noreferrer" title={address}>{children || <bdi>{short(address)}</bdi>}<span aria-hidden="true"> ↗</span></a>;
}
export default function App() {
  const [runtime, setRuntime] = useState<Runtime>();
  const [bootError, setBootError] = useState('');
  const [account, setAccount] = useState<Address>();
  const [walletChain, setWalletChain] = useState<number>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [tx, setTx] = useState<Hash>();
  const [revision, setRevision] = useState(0);
  const [offset, setOffset] = useState(0n);
  const [selected, setSelected] = useState<bigint>();
  const [lookup, setLookup] = useState('');
  const [amount, setAmount] = useState('10');
  const [hours, setHours] = useState('24');
  const [seats, setSeats] = useState('4');
  const [now, setNow] = useState(Date.now());

  useEffect(() => { let active = true; loadRuntime().then(r => { if (active) setRuntime(r); }).catch(e => { if (active) setBootError(explain(e)); }); return () => { active = false; }; }, []);
  const syncWallet = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) return;
    try {
      const [accounts, chain] = await Promise.all([provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' })]);
      setAccount(accounts[0]); setWalletChain(Number(chain));
    } catch { setAccount(undefined); setWalletChain(undefined); }
  }, []);
  useEffect(() => {
    void syncWallet();
    const provider = window.ethereum;
    const changed = () => { setSnapshot(undefined); setAccount(undefined); setWalletChain(undefined); void syncWallet(); };
    provider?.on?.('accountsChanged', changed); provider?.on?.('chainChanged', changed); provider?.on?.('disconnect', changed);
    return () => { provider?.removeListener?.('accountsChanged', changed); provider?.removeListener?.('chainChanged', changed); provider?.removeListener?.('disconnect', changed); };
  }, [syncWallet]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!runtime) return;
    let active = true;
    let running = false;
    const refresh = async () => {
      if (running) return;
      running = true; setLoading(true);
      try {
        const next = await readSnapshot(runtime, readClient(runtime, window.ethereum, walletChain), account, offset, selected);
        if (active) { setSnapshot(next); setReadError(''); }
      } catch (e) { if (active) { setSnapshot(undefined); setReadError(explain(e)); } }
      finally { running = false; if (active) setLoading(false); }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 20000);
    return () => { active = false; clearInterval(timer); };
  }, [runtime, account, walletChain, offset, selected, revision]);

  const fresh = !!snapshot && now - snapshot.loadedAt < 60000;
  const ready = !!runtime && !!account && account === snapshot?.account && walletChain === runtime.chain.id && fresh && !loading && !busy;
  const values = createValues(amount, hours, seats, snapshot);
  const detail = snapshot && snapshot.detail?.id === selected ? snapshot.detail : undefined;
  const eligibilityState = detail && snapshot ? eligibility(detail, snapshot, account) : undefined;
  const fmt = (n: bigint) => units(n, snapshot?.decimals ?? 18);
  const reason = !account ? 'Connect a browser wallet to take part.' : runtime && walletChain !== runtime.chain.id ? `Switch to ${runtime.chain.name} to continue.` : readError ? 'Live reads failed. Refresh before continuing.' : loading ? 'Refreshing live state…' : !fresh ? 'Waiting for a verified, fresh contract snapshot.' : busy ? 'Finish the current wallet request first.' : '';
  async function connect() {
    if (!window.ethereum) { setError('No browser wallet found. Open this page in an Ethereum wallet browser or install a browser wallet, then reload.'); return; }
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await window.ethereum.request({ method: 'eth_requestAccounts' }); await syncWallet(); setStatus('Wallet connected. Review the network and balances below.'); }
    catch (e) { setError(explain(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function changeChain() {
    if (!runtime || !window.ethereum || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await switchNetwork(window.ethereum, runtime); await syncWallet(); setStatus(`Switched to ${runtime.chain.name}.`); }
    catch (e) { setError(explain(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function transact(name: string, args: readonly unknown[] = [], approval = false) {
    if (!ready || !runtime || !account || !window.ethereum || busyRef.current) return;
    const provider = window.ethereum;
    busyRef.current = true; setBusy(true); setError(''); setTx(undefined); setStatus('Checking the transaction against current contract state…');
    let submitted = false;
    try {
      const client = readClient(runtime, provider, walletChain);
      // Re-verify code, token binding, and RPC chain immediately before simulation.
      await readSnapshot(runtime, client, account, offset, selected);
      const contract = approval ? runtime.token : runtime.app;
      const { request } = await client.simulateContract({ address: contract.address, abi: contract.abi, functionName: name, args, account });
      const [currentAccounts, currentChain] = await Promise.all([provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' })]);
      if (Number(currentChain) !== runtime.chain.id || currentAccounts[0]?.toLowerCase() !== account.toLowerCase()) throw Error('Wallet account or network changed. Reconnect before continuing.');
      setStatus(approval ? 'Confirm the exact CIRC allowance in your wallet.' : `Confirm ${name === 'closeRound' ? 'close round' : name} in your wallet.`);
      const wallet = createWalletClient({ account, chain: runtime.chain, transport: custom(provider) });
      const hash = await wallet.writeContract(request);
      submitted = true; setTx(hash); setStatus('Transaction submitted. Waiting for confirmation…');
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120000 });
      if (receipt.status !== 'success') throw Error('Transaction reverted on-chain. No contract action completed.');
      setStatus(approval ? 'Approval confirmed. You can now submit the payment as a separate transaction.' : 'Transaction confirmed. Refreshing balances and circles.');
    } catch (e) {
      setError(submitted ? `Confirmation failed or is still pending. Check the transaction on the explorer before retrying. ${explain(e)}` : explain(e));
      setStatus('');
    } finally {
      setSnapshot(undefined); setRevision(v => v + 1); busyRef.current = false; setBusy(false);
    }
  }
  function payment(label: string, cost: bigint, eligible: boolean, name: string, args: readonly unknown[], primary = false) {
    const approved = !!snapshot && snapshot.allowance >= cost;
    const funded = !!snapshot && snapshot.balance >= cost;
    return <div className="payment">
      <p className="small">{fmt(cost)} CIRC {name === 'contribute' ? 'contribution' : 'bond'} · two separate wallet steps</p>
      <div className="actions">
        <button disabled={!ready || !eligible || !funded || approved} onClick={() => void transact('approve', [runtime!.app.address, cost], true)}>{approved ? '1. Approved' : '1. Approve CIRC'}</button>
        <button className={primary && account ? 'primary' : ''} disabled={!ready || !eligible || !funded || !approved} onClick={() => void transact(name, args)}>{`2. ${label}`}</button>
      </div>
      {account && snapshot && !funded && <p className="small warning-text">You need {fmt(cost)} CIRC; your balance is {fmt(snapshot.balance)} CIRC.</p>}
      {eligible && funded && !approved && account && <p className="small muted">Approve SavingsCircle to spend exactly {fmt(cost)} CIRC, then confirm the payment.</p>}
    </div>;
  }

  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="header shell">
      <a className="brand" href="#"><Mark /><span>circle<span className="brand-dot">.</span></span></a>
      <div className="wallet-nav"><span className="network-badge">{runtime?.chain.name ?? 'Sepolia'} testnet</span>
        {account && runtime ? <><AddressLink runtime={runtime} address={account} /><button disabled={busy} onClick={() => { setAccount(undefined); setSnapshot(undefined); setStatus('Disconnected from this page.'); }}>Disconnect</button></> : <button className="primary" disabled={busy || !!bootError} onClick={() => void connect()}>{busy ? 'Connecting…' : 'Connect wallet'}</button>}
      </div>
    </header>
    <main id="main" className="shell" tabIndex={-1}>
      <section className="intro" aria-labelledby="title">
        <div><p className="eyebrow">Small groups. Shared commitment.</p><h1 id="title">Save together.<br /><span>Take your turn.</span></h1><p className="lede">A shared pot, a fixed contribution, and a turn for every seat. Start a savings circle with CIRC on Sepolia.</p></div>
        <div className="how-it-works"><p className="eyebrow">How a circle works</p><ol><li><span>01</span><div><strong>Gather your circle</strong><p>Choose 2–10 seats. Each member deposits a bond.</p></div></li><li><span>02</span><div><strong>Contribute each round</strong><p>Pay the same CIRC amount before each deadline.</p></div></li><li><span>03</span><div><strong>Collect on your turn</strong><p>Seats take turns. Withdraw your credited pot.</p></div></li></ol></div>
      </section>
      <div className="notice"><strong>Sepolia experiment</strong><p>CIRC comes from swapping Sepolia ETH in the factory-seeded launch pool, outside this page. Missing a round forfeits your later turn and bond. The deployed design has known carry and all-default cases where a defaulter can profit; the bond does not guarantee protection.</p></div>
      {bootError && <p className="error" role="alert">{bootError} Reload the page to retry deployment verification.</p>}
      {runtime && account && walletChain !== runtime.chain.id && <div className="network-warning"><p>Your wallet is on the wrong network. This circle uses {runtime.chain.name}.</p><button disabled={busy} onClick={() => void changeChain()}>Switch to {runtime.chain.name}</button></div>}
      <div className="feedback" aria-busy={busy}><p role="status">{status}</p>{error && <p role="alert" className="error">{error}</p>}{tx && runtime && <a href={`${runtime.deployment.network.explorer}/tx/${tx}`} target="_blank" rel="noreferrer">View transaction {short(tx)} ↗</a>}</div>
      <section className="wallet-panel" aria-labelledby="wallet-title"><div className="section-heading"><div><p className="eyebrow">Your CIRC</p><h2 id="wallet-title">Ready for your next round</h2></div><button disabled={!ready || !snapshot?.withdrawable} onClick={() => void transact('withdraw')}>Withdraw CIRC <span aria-hidden="true">↗</span></button></div>
        <dl className="balances"><Stat label="Wallet balance">{account && snapshot ? fmt(snapshot.balance) : '—'}<small>CIRC</small></Stat><Stat label="Allowance to SavingsCircle">{account && snapshot ? fmt(snapshot.allowance) : '—'}<small>CIRC</small></Stat><Stat label="Withdrawable balance">{account && snapshot ? fmt(snapshot.withdrawable) : '—'}<small>CIRC</small></Stat></dl>
        <p className="small muted">{reason || 'Withdraw collects all of your credited pots, returned bonds and final distributions.'}</p>
      </section>
      <div className="workspace">
        <section className="create-panel" aria-labelledby="create-title"><div className="section-heading"><div><p className="eyebrow">Start something together</p><h2 id="create-title">Open a circle</h2></div><span className="round-icon" aria-hidden="true">＋</span></div>
          <p className="muted">You take seat 1. The first round starts as soon as the final seat fills.</p>
          <div className="fields"><label htmlFor="contribution">Contribution per round <span>CIRC</span></label><input id="contribution" name="contribution" inputMode="decimal" autoComplete="off" value={amount} onChange={e => setAmount(e.target.value)} aria-describedby="create-hint create-error" aria-invalid={values.field === 'contribution'} />
          <div className="field-pair"><div><label htmlFor="hours">Round length <span>hours</span></label><input id="hours" name="roundHours" inputMode="numeric" value={hours} onChange={e => setHours(e.target.value)} aria-describedby="create-hint create-error" aria-invalid={values.field === 'hours'} /></div><div><label htmlFor="seats">Seats <span>2–10</span></label><select id="seats" name="seats" value={seats} onChange={e => setSeats(e.target.value)}>{Array.from({ length: 9 }, (_, i) => <option key={i} value={i + 2}>{i + 2} members</option>)}</select></div></div></div>
          <p id="create-hint" className="small muted">At least 1 CIRC per round · 1–720 whole hours per round.</p><p id="create-error" className="small error" aria-live="polite">{values.error}</p>
          <div className="bond-summary"><span>Your joining bond</span><strong>{values.bond !== undefined ? fmt(values.bond) : '—'} <small>CIRC</small></strong><p className="small">(Seats − 1) × contribution. This is held separately from your round payments.</p></div>
          {values.bond !== undefined ? payment('Open circle', values.bond, true, 'create', [values.contribution, values.roundLength, values.seats], true) : <p className="small">Correct the fields above to continue.</p>}
          <p className="small muted">Unfilled after 7 days? Anyone can cancel so members can withdraw their bonds.</p>
        </section>
        <section className="circles-panel" aria-labelledby="circles-title"><div className="section-heading"><div><p className="eyebrow">On-chain circles</p><h2 id="circles-title">Find your circle {snapshot && <span className="count">{snapshot.count.toString()}</span>}</h2></div><button className="compact" disabled={loading || busy || !runtime} onClick={() => setRevision(v => v + 1)}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
          <form className="lookup" onSubmit={e => { e.preventDefault(); if (/^\d+$/.test(lookup) && snapshot && BigInt(lookup) < snapshot.count) { setSelected(BigInt(lookup)); setError(''); } else setError('Enter an existing circle ID from 0 to the circle count minus one.'); }}><label htmlFor="circle-id" className="small">Circle ID</label><div className="actions"><input id="circle-id" name="circleId" inputMode="numeric" placeholder="e.g. 0" value={lookup} onChange={e => setLookup(e.target.value)} /><button type="submit" disabled={!snapshot || busy}>Find circle</button></div></form>
          {readError && <p role="alert" className="error">Live state unavailable. {readError}</p>}
          {!snapshot && !readError && !bootError && <div className="empty"><Mark /><h3>Reading the chain</h3><p>Checking deployment and loading circles…</p></div>}
          {snapshot?.count === 0n && <div className="empty"><Mark /><h3>The first circle starts with you.</h3><p>Open a circle, share its ID with your group, and start saving together.</p></div>}
          {snapshot && snapshot.count > 0n && <><div className="circle-list">{snapshot.circles.map(({ id, circle }) => <button key={id.toString()} className={`circle-row ${selected === id ? 'selected' : ''}`} aria-pressed={selected === id} onClick={() => setSelected(id)}><span className="circle-number">{id.toString().padStart(2, '0')}</span><span><strong>Circle #{id.toString()}</strong><span className="small muted">{fmt(circle.contribution)} CIRC / round · {Number(circle.roundLength) / 3600} h</span></span><span className="row-meta"><span className="badge">{states[circle.state]}</span><span className="small">{circle.joined.toString()}/{circle.seats.toString()} seats</span></span></button>)}</div><div className="pagination"><button disabled={offset === 0n || loading} onClick={() => setOffset(v => v - 6n)}>Previous</button><span className="small">IDs {offset.toString()}–{(offset + 5n < snapshot.count ? offset + 5n : snapshot.count - 1n).toString()}</span><button disabled={offset + 6n >= snapshot.count || loading} onClick={() => setOffset(v => v + 6n)}>Next</button></div></>}
          {snapshot && <p className="read-status small">{loading ? 'Refreshing' : fresh ? 'Live snapshot' : 'Snapshot expired'} · block {snapshot.block.toString()} · {date(snapshot.timestamp)}</p>}
        </section>
      </div>
      {selected !== undefined && !detail && loading && <p role="status">Loading circle #{selected.toString()}…</p>}
      {detail && snapshot && runtime && eligibilityState && <section className="detail-panel" aria-labelledby="detail-title"><div className="section-heading"><div><p className="eyebrow">{states[detail.circle.state]}</p><h2 id="detail-title">Circle #{detail.id.toString()}</h2></div><p className="small muted">Share this circle’s ID: {detail.id.toString()}</p></div>
        <dl className="detail-stats"><Stat label="Contribution / round">{fmt(detail.circle.contribution)} <small>CIRC</small></Stat><Stat label="Current round">{detail.circle.state === 0 || detail.circle.state === 2 ? 'Not started' : detail.currentRound < detail.circle.seats ? `${detail.currentRound + 1n} of ${detail.circle.seats}` : 'All windows ended'}</Stat><Stat label="Current round pot">{fmt(detail.pot)} <small>CIRC</small></Stat><Stat label="Carried pot">{fmt(detail.circle.carry)} <small>CIRC</small></Stat></dl>
        <p className="schedule">{detail.circle.state === 0 ? `Join before ${date(detail.circle.createdAt + snapshot.joinPeriod)}.` : detail.circle.state === 1 && detail.currentRound < detail.circle.seats ? `Round ${detail.currentRound + 1n} closes ${date(detail.circle.start + (detail.currentRound + 1n) * detail.circle.roundLength)}. Seat ${detail.currentRound + 1n} has this turn; payout requires contributions in every round through this turn.` : detail.circle.state === 1 ? 'All contribution windows have ended. Close any remaining rounds in order to settle the circle.' : 'Settlement credits are available through Withdraw CIRC.'}</p>
        <div className="seat-grid">{Array.from({ length: Number(detail.circle.seats) }, (_, seat) => { const member = detail.members[seat]; const paid = member && (member.paid & (1n << detail.currentRound)) !== 0n; return <div className="seat" key={seat}><span className="small muted">Seat {seat + 1}{detail.circle.state === 1 && BigInt(seat) === detail.currentRound ? ' · current turn' : ''}</span><strong>{member ? <AddressLink runtime={runtime} address={member.address}>{member.address.toLowerCase() === account?.toLowerCase() ? 'You' : short(member.address)}</AddressLink> : 'Open seat'}</strong><span className={`small ${member?.inDefault ? 'warning-text' : ''}`}>{!member ? 'Waiting for a member' : member.inDefault ? 'In default' : detail.circle.state === 0 ? 'Bond deposited' : detail.circle.state === 2 ? 'Bond credited' : detail.currentRound >= detail.circle.seats ? 'All rounds paid' : paid ? 'Paid this round' : 'Payment due this round'}</span></div>; })}</div>
        <div className="detail-actions"><div><h3>Join & contribute</h3>{detail.circle.state === 0 ? <>{payment('Join circle', (detail.circle.seats - 1n) * detail.circle.contribution, eligibilityState.join, 'join', [detail.id])}{eligibilityState.self && <p className="small">You already have a seat.</p>}{snapshot.timestamp >= detail.circle.createdAt + snapshot.joinPeriod && <p className="small">Recruitment has expired. Cancel to release bonds.</p>}</> : detail.circle.state === 1 ? <>{payment('Contribute', detail.circle.contribution, eligibilityState.contribute, 'contribute', [detail.id])}<p className="small muted">{!eligibilityState.self ? 'Only members can contribute.' : eligibilityState.self.inDefault ? 'You missed a round and can no longer contribute.' : detail.currentRound >= detail.circle.seats ? 'All contribution windows have ended.' : !eligibilityState.contribute ? 'You have paid this round.' : 'Pay before the deadline to keep your later turn and bond.'}</p></> : <p className="muted">This circle is settled. Collect any credit from your withdrawable balance.</p>}</div>
          <div><h3>Settle the circle</h3><p className="small muted">Anyone can close ended rounds in order or cancel expired recruitment. No CIRC approval is needed.</p><div className="actions"><button disabled={!ready || !eligibilityState.close} onClick={() => void transact('closeRound', [detail.id, detail.circle.nextRound])}>Close round {detail.circle.nextRound < detail.circle.seats ? (detail.circle.nextRound + 1n).toString() : '—'}</button><button disabled={!ready || !eligibilityState.cancel} onClick={() => void transact('cancel', [detail.id])}>Cancel unfilled circle</button></div>{detail.circle.state === 1 && detail.circle.nextRound < detail.circle.seats && <p className="small muted">Next closure: round {detail.circle.nextRound + 1n}, after {date(detail.circle.start + (detail.circle.nextRound + 1n) * detail.circle.roundLength)}. Pot plus carry: {fmt(detail.nextPot + detail.circle.carry)} CIRC.</p>}</div></div>
        <p className="small muted">Bonds held: {fmt(detail.circle.bondsHeld)} CIRC · All unclosed pots: {fmt(detail.circle.openPots)} CIRC. Seat and round numbers are displayed from 1; contract indices start at 0.</p>
      </section>}
      <details className="rules"><summary>Understand the commitments</summary><div><p>Each member’s bond is (seats − 1) × the contribution. You also pay one contribution per round. The first round starts when the last seat fills, and deadlines keep running even if nobody closes a round.</p><p>Missing any round puts you in default permanently. Your later turn is lost; its pot carries forward. Eligible recipients collect their credited pots with Withdraw CIRC. A missed later round does not remove a pot already earned.</p><p>At the end, members who paid every round get their bonds back and share forfeited bonds and final carry. If nobody paid every round, prior contributors share those funds instead. If nobody ever contributed, everyone gets their bond back. Any remainder goes to the lowest eligible seat. These carry and fallback rules can reward defaulting; this testnet deployment has no admin, pause or upgrade path.</p><p>Approval only sets a spending allowance. It does not reserve a seat or make a contribution. Each action needs a separate wallet confirmation and Sepolia ETH for gas.</p></div></details>
    </main>
    <footer className="shell"><div className="footer-brand"><Mark /><strong>Built around commitment.</strong></div>{runtime && <div className="contract-links"><AddressLink runtime={runtime} address={runtime.app.address}>SavingsCircle contract</AddressLink><AddressLink runtime={runtime} address={runtime.token.address}>CIRC token</AddressLink><a href="./imd-deployment.json">Deployment record ↗</a></div>}<p className="small muted">Circle · Sepolia testnet · State comes directly from contract views.</p></footer>
  </>;
}
