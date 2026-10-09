import { PixelTick } from './PixelTick.tsx';
import { useState } from 'react';
import { isAddress } from '../chain.ts';

// A lookup for any wallet's rare tokens; it opens that wallet's page.
export function VerifyBox() {
  const [input, setInput] = useState('');
  const [bad, setBad] = useState(false);
  return (
    <div className="closer-box">
      <PixelTick className="verify-check" />
      <h2>Verify holdings</h2>
      {/* DRAFT subtitle, awaiting Harriet's approval. */}
      <p className="muted">Check which rare $PROOF any wallet holds.</p>
      <form
        className="closer-form"
        onSubmit={(e) => {
          e.preventDefault();
          const a = input.trim();
          if (isAddress(a)) location.hash = `#/wallet/${a}`;
          else setBad(true);
        }}
      >
        <input placeholder="Paste a Solana address" value={input} onChange={(e) => { setInput(e.target.value); setBad(false); }} aria-label="Wallet address" spellCheck={false} />
        <button className="btn btn-primary">Verify</button>
      </form>
      {bad && <p className="error-note">That doesn't look like a Solana address.</p>}
    </div>
  );
}
