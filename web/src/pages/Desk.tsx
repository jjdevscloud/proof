import { useState } from 'react';
import { api, useApi } from '../api.ts';
import type { Envelope, Proof } from '../api.ts';
import { useConfig, useVault } from '../App.tsx';
import type { Check } from '../chain.ts';
import { useWallet } from '../chain.ts';
import { fmtTokens, short, sol } from '../format.ts';
import { verifyStrike } from '../verify.ts';
import { Addr, ErrorNote, Loading, Modal, SegmentList, runTx } from '../components/ui.tsx';

export function Desk() {
  const { data, error } = useApi<Envelope[]>('/envelopes?status=listed');
  const [reviewing, setReviewing] = useState<Envelope | null>(null);
  const listings = [...(data ?? [])].sort((a, b) => Number(BigInt(a.price) - BigInt(b.price)));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Collector desk</h1>
          <p className="muted">
            Sealed envelopes for sale. You buy the envelope: the tokens never leave the vault, so their rarity stays intact.
            Every listing is checked against the chain in your browser before you can buy.
          </p>
        </div>
      </div>
      {error && <ErrorNote error={error} />}
      {!data && !error && <Loading />}
      {data && !listings.length && (
        <div className="panel empty">
          <h2>No envelopes listed right now</h2>
          <p className="muted">Holders seal rare tokens into envelopes from <a href="#/wallet">their wallet page</a> and list them here.</p>
        </div>
      )}
      <div className="cards">
        {listings.map((e) => (
          <article key={e.address} className="card listing">
            <div className="card-head">
              <span className="pill pill-seal">Envelope {short(e.address)}</span>
              <span className="price">{sol(e.price)} <small>SOL</small></span>
            </div>
            <SegmentList segments={e.segments} empty="No rare tokens — this envelope's seal was invalid." />
            {BigInt(e.common) > 0n && <p className="small muted">+ {fmtTokens(e.common)} ordinary $PROOF</p>}
            <div className="card-foot">
              <span className="small muted">Seller <Addr value={e.holder} href={`#/wallet/${e.holder}`} /></span>
              <button className="btn btn-primary" onClick={() => setReviewing(e)}>Review & buy</button>
            </div>
          </article>
        ))}
      </div>
      {reviewing && <BuyModal envelope={reviewing} onClose={() => setReviewing(null)} />}
    </>
  );
}

function BuyModal({ envelope, onClose }: { envelope: Envelope; onClose: () => void }) {
  const vault = useVault();
  const config = useConfig();
  const wallet = useWallet();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const runChecks = async () => {
    setRunning(true);
    setErr(null);
    try {
      const list = await vault.checkEnvelope(envelope.address, { holder: envelope.holder, price: envelope.price, ranges: envelope.ranges });
      if (config.revealed) {
        for (const strike of new Set(envelope.segments.map((s) => s.strike))) {
          const proof = await api<Proof>(`/proof/${strike}`);
          const res = await verifyStrike(proof);
          list.push({ label: `Strike #${strike} traits match the pre-launch commitment`, ok: res.ok && proof.root === config.commitRoot, detail: proof.strike.traits.join(', ') });
        }
      }
      setChecks(list);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const allOk = !!checks && checks.every((c) => c.ok);
  const isSeller = wallet.address === envelope.holder;

  return (
    <Modal title={`Envelope ${short(envelope.address)}`} onClose={onClose}>
      <SegmentList segments={envelope.segments} />
      <div className="buy-summary">
        <span>Price</span>
        <strong className="price">{sol(envelope.price)} SOL</strong>
      </div>
      <p className="small muted">
        Buying makes you the envelope's holder. You can keep it, gift it, list it again, or withdraw the tokens —
        withdrawing melts them into ordinary $PROOF.
      </p>

      {!checks ? (
        <button className="btn btn-ghost wide" onClick={runChecks} disabled={running}>
          {running ? 'Checking the chain…' : 'Run safety checks'}
        </button>
      ) : (
        <ul className="checks">
          {checks.map((c) => (
            <li key={c.label} className={c.ok ? 'ok' : 'bad'}>
              <span aria-hidden>{c.ok ? '✓' : '✗'}</span>
              <span>{c.label}{c.detail && <span className="muted small"> · {c.detail}</span>}</span>
            </li>
          ))}
        </ul>
      )}
      {err && <ErrorNote error={err} />}
      {checks && !allOk && <ErrorNote error="Some checks failed. Do not buy this envelope." />}

      {allOk && (
        !wallet.address ? (
          <button className="btn btn-primary wide" onClick={() => wallet.connect().catch((e) => setErr(e.message))}>Connect wallet to buy</button>
        ) : isSeller ? (
          <p className="muted">This is your own listing.</p>
        ) : (
          <button
            className="btn btn-primary wide"
            onClick={async () => {
              const sig = await runTx('Buy envelope', () => vault.buy(wallet.address!, envelope.holder, envelope.address, BigInt(envelope.price)));
              if (sig) onClose();
            }}
          >
            Buy for {sol(envelope.price)} SOL
          </button>
        )
      )}
    </Modal>
  );
}
