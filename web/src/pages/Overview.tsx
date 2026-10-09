import { HeroWord } from '../components/HeroWord.tsx';
import { ScrollLines } from '../components/ScrollLines.tsx';
import { Mechanisms } from '../components/Mechanisms.tsx';
import { TraitsTable } from '../components/TraitsTable.tsx';
import { VerifyBox } from '../components/Closer.tsx';
import { BlockField } from '../components/BlockField.tsx';

export function Overview() {

  return (
    <>
      <section className="hero">
        <div className="caption">
          <h1>An Ordinal Theory for<br />Solana Tokens.</h1>
        </div>
        <div className="frame hero-frame"><HeroWord text="SEQUENTS" /></div>
        <div className="trio">
          <p><strong>Sequents</strong> <span>the rules that number every token and decide which ones are rare.</span></p>
          <p><strong>$PROOF</strong> <span>the first token to implement<br />Sequent Theory.</span></p>
          <p><strong>Strikes</strong> <span>a run of one million tokens, the thing that holds traits and rarity.</span></p>
        </div>
        {/* An arrow under the middle line so it is clear the page carries on below. */}
        <svg className="scroll-cue" viewBox="0 0 16 28" aria-hidden><path d="M8 1v25M1 19l7 7 7-7" /></svg>
      </section>

      <ScrollLines
        text="In 2022, Casey Rodarmor gave every Bitcoin sat a number, and some sats became rare. Solana never had an equivalent because Solana wallets store balances not individual coins, so a token's history disappears the moment it moves. Sequents proposes a solution: keep rare tokens where their history can be proven, in the account that bought them, or sealed in an envelope that never moves them. Every $PROOF has a number, and some numbers are rare."
        after={
          <>
            <p className="muted">Read Our Proposal</p>
            <a className="btn btn-primary" href={`${import.meta.env.BASE_URL}Sequents_Whitepaper.pdf`} target="_blank" rel="noreferrer">Whitepaper</a>
          </>
        }
      />

      <Mechanisms />

      <TraitsTable />

      <ScrollLines
        className="verify"
        text="Nothing in Sequents asks to be trusted. You can check every trait yourself with the following steps, or verify any wallet's holdings below."
        link={{ phrase: 'following steps', href: `${import.meta.env.BASE_URL}Sequents_Whitepaper.pdf#page=8` }}
        after={<VerifyBox />}
      />



      <section className="closer"><BlockField /></section>
    </>
  );
}
