import { RollStats } from '../components/Roll.tsx';

// Rolls: the rolled tiers after the curve, live from the chain. Its own page, apart from the Strikes,
// because rolls are envelopes of ordinary $PROOF, not Strikes from the curve.
export function Rolls() {
  return <RollStats title="Rolls" pageHead />;
}
