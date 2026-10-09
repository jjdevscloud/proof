import { HeroWord } from './HeroWord.tsx';

// The rules page title, drawn exactly like the overview's word: two lines at one size, with envelopes
// lifting out of the letters. Decorative only.
export function RulesHero() {
  return (
    <div className="rules-word">
      <HeroWord text="SAME COIN" sizeAs="TWO MARKETS" />
      <HeroWord text="TWO MARKETS" />
    </div>
  );
}
