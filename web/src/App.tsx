import { Fragment, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { bumpVersion, subscribe, useApi } from './api.ts';
import type { Config } from './api.ts';
import { Vault, useWallet } from './chain.ts';
import { short } from './format.ts';
import { ErrorNote, Loading, Toasts } from './components/ui.tsx';
import { Overview } from './pages/Overview.tsx';
import { Strikes } from './pages/Strikes.tsx';
import { StrikePage } from './pages/Strike.tsx';
import { Desk } from './pages/Desk.tsx';
import { WalletPage } from './pages/Wallet.tsx';
import { Rules } from './pages/Rules.tsx';
import { Traits } from './pages/Traits.tsx';
import { Glossary } from './pages/Glossary.tsx';
import { Rolls } from './pages/Rolls.tsx';
import { Prelaunch } from './pages/Prelaunch.tsx';
import { DEMO } from './demo.ts';
import { Logo } from './components/Logo.tsx';

const ConfigContext = createContext<{ config: Config; vault: Vault } | null>(null);
export function useConfig(): Config {
  return useContext(ConfigContext)!.config;
}
export function useVault(): Vault {
  return useContext(ConfigContext)!.vault;
}

function useRoute(): string[] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => {
      setHash(location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

// The pages about the project first, then the live $PROOF pages (data from the chain), split in the nav.
const NAV = [
  ['', 'Overview'],
  ['rules', 'Rules'],
  ['traits', 'Traits'],
  ['glossary', 'Glossary'],
  ['strikes', 'Strikes'],
  ['rolls', 'Rolls'],
  ['desk', 'Desk'],
  ['wallet', 'My wallet'],
] as const;
const LIVE_FROM = 'strikes';

export function App() {
  const { data: config, error, reload } = useApi<Config>('/config');
  // Pre-launch there is no mint, so no vault to talk to (only the Prelaunch and Rules pages render).
  const vault = useMemo(() => (config && !config.pending ? new Vault(config) : null), [config]);
  const route = useRoute();

  useEffect(() => subscribe(() => bumpVersion()), []);
  // Pre-launch, check every few seconds: the moment the mint is recorded the site switches to live
  // in place, without visitors reloading.
  useEffect(() => {
    if (!config?.pending) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [config?.pending, reload]);

  return (
    <>
      {DEMO && <div className="demo-banner">Preview with demo data — nothing here is real, and no transactions are sent.</div>}
      <Header route={route[0] ?? ''} pending={!!config?.pending} />
      <main className="container">
        {error && !config && (
          <div className="panel">
            <h2>Can't reach the ledger</h2>
            <ErrorNote error={`The indexer API isn't responding (${error}). Rarity data comes from it; please try again shortly.`} />
          </div>
        )}
        {!config && !error && <Loading what="Connecting to the ledger" />}
        {config && (vault || config.pending) && (
          <ConfigContext.Provider value={{ config, vault: vault! }}>
            {config.pending && route[0] !== undefined && route[0] !== 'rules' ? <Prelaunch /> : <Page route={route} />}
          </ConfigContext.Provider>
        )}
      </main>
      <Footer />
      <Toasts />
    </>
  );
}

function Page({ route }: { route: string[] }) {
  switch (route[0]) {
    case undefined:
      return <Overview />;
    case 'strikes':
      return <Strikes />;
    case 'strike':
      return <StrikePage n={Number(route[1])} />;
    case 'desk':
      return <Desk />;
    case 'wallet':
      return <WalletPage address={route[1] ?? null} />;
    case 'rules':
      return <Rules />;
    case 'traits':
      return <Traits />;
    case 'glossary':
      return <Glossary />;
    case 'rolls':
      return <Rolls />;
    default:
      return (
        <div className="panel">
          <h2>Not found</h2>
          <p><a href="#/">Back to the overview</a></p>
        </div>
      );
  }
}

function Header({ route, pending }: { route: string; pending: boolean }) {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <header className="site-header">
      <div className="container header-inner">
        <a className="brand" href="#/">
          <Logo />
          <span className="brand-text"><strong>Sequents</strong></span>
        </a>
        <button className="icon-btn nav-toggle" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>☰</button>
        <nav className={open ? 'nav open' : 'nav'} onClick={() => setOpen(false)}>
          {NAV.filter(([path]) => !pending || path === '' || path === 'rules').map(([path, label]) => (
            <Fragment key={path}>
              {/* DRAFT label, awaiting Harriet's approval. */}
              {path === LIVE_FROM && <span className="nav-live" aria-label="Live $PROOF data"><i />Live</span>}
              <a href={`#/${path}`} className={route === path || (path === 'strikes' && route === 'strike') ? 'active' : ''}>{label}</a>
            </Fragment>
          ))}
        </nav>
        <div className="header-right">
        <div className="wallet-btn">
          {pending ? (
            <span className="pill">Launching soon</span>
          ) : wallet.address ? (
            <WalletMenu address={wallet.address} onDisconnect={() => wallet.disconnect()} />
          ) : wallet.restoring ? (
            <button className="btn btn-ghost" disabled>Reconnecting…</button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => wallet.connect().then(() => (location.hash = '#/wallet')).catch((e) => setErr(e.message))}
            >
              Connect wallet
            </button>
          )}
        </div>
        {/* The moving button now connects a wallet (it used to link to Check my wallet). Once connected, the
            wallet menu beside it takes over. */}
        {!pending && !wallet.address && !wallet.restoring && (
          <button
            className="btn btn-primary btn-cycle"
            onClick={() => wallet.connect().then(() => (location.hash = '#/wallet')).catch((e) => setErr(e.message))}
          >
            Connect wallet
          </button>
        )}
        </div>
      </div>
      {err && (
        <div className="container">
          <p className="error-note small" onClick={() => setErr(null)}>{err}</p>
        </div>
      )}
    </header>
  );
}

// Clicking the address opens a menu; disconnecting is a deliberate second click.
function WalletMenu({ address, onDisconnect }: { address: string; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.('.wallet-menu')) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="wallet-menu">
      {/* Connected: the address inside the same black moving button as Connect wallet. A click opens the menu. */}
      <button className="btn btn-primary btn-cycle wallet-connected" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        {short(address)}
      </button>
      {open && (
        <div className="menu" role="menu">
          <a role="menuitem" href="#/wallet" onClick={() => setOpen(false)}>My wallet</a>
          <button
            role="menuitem"
            onClick={() => {
              navigator.clipboard?.writeText(address);
              setOpen(false);
            }}
          >
            Copy address
          </button>
          <button role="menuitem" className="danger-text" onClick={() => { setOpen(false); onDisconnect(); }}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <span>© {new Date().getFullYear()} Sequents</span>
      </div>
    </footer>
  );
}
