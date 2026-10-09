// The reveal plays only right after the user presses Connect wallet, not on a silent reconnect or a
// normal visit to My wallet. Display only: nothing here touches the wallet itself.
let pending = false;
export const markConnect = () => { pending = true; };
export const takeConnect = () => { const p = pending; pending = false; return p; };
