import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../session.js';
import { Skeleton } from './ui.js';

const LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/solo', label: 'Solo bills', end: false },
  { to: '/groups', label: 'Groups', end: false },
  { to: '/settings', label: 'Settings', end: false },
];

/** The app's mark: a small receipt with a torn edge. Decorative. */
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 28 32" aria-hidden="true" focusable="false">
      <path d="M3 2h22v26l-3.7-2.4-3.6 2.4-3.7-2.4-3.7 2.4-3.6-2.4L3 28z" fill="var(--accent)" />
      <path d="M8 9h12M8 14h12M8 19h7" stroke="var(--on-accent)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <ul className="nav-list">
      {LINKS.map((l) => (
        <li key={l.to}>
          <NavLink to={l.to} end={l.end} className="nav-link" onClick={onNavigate}>
            {l.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

/** The logged-in frame: sidebar on wide screens, a menu button on phones. */
export function AppLayout() {
  const { account, recoveryCode, setRecoveryCode } = useSession();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);

  // Once inside the app, a recovery code from sign-up or reset is never shown again.
  useEffect(() => {
    if (account && recoveryCode) setRecoveryCode(null);
  }, [account, recoveryCode, setRecoveryCode]);

  // After moving to another page, put keyboard focus on its heading.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const main = mainRef.current;
    if (!main) return;
    const focusHeading = () => {
      const heading = main.querySelector<HTMLElement>('h1');
      if (!heading) return false;
      heading.focus();
      return true;
    };
    if (focusHeading()) return;
    // Pages that load data show their heading a moment later.
    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    observer.observe(main, { childList: true, subtree: true });
    const stop = window.setTimeout(() => observer.disconnect(), 5000);
    return () => {
      observer.disconnect();
      window.clearTimeout(stop);
    };
  }, [location.pathname]);

  if (account === undefined) {
    return (
      <div className="boot">
        <Skeleton lines={4} />
      </div>
    );
  }
  if (account === null) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <span>Bill Splitter</span>
        </div>
        <nav aria-label="Main">
          <NavLinks />
        </nav>
      </aside>
      <header className="topbar">
        <span className="brand">
          <Logo />
          <span>Bill Splitter</span>
        </span>
        <button
          type="button"
          className="btn btn-secondary menu-button"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          onClick={() => setMenuOpen((o) => !o)}
        >
          Menu
        </button>
      </header>
      {menuOpen && (
        <nav id="mobile-nav" className="mobile-nav" aria-label="Main">
          <NavLinks onNavigate={() => setMenuOpen(false)} />
        </nav>
      )}
      <main id="main" ref={mainRef} className="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

/** Frame for the login, sign-up and reset pages. */
export function PublicLayout() {
  const { account, recoveryCode } = useSession();
  if (account === undefined) {
    return (
      <div className="boot">
        <Skeleton lines={4} />
      </div>
    );
  }
  // Logging in always lands on the Dashboard. The recovery code screen stays
  // visible right after sign-up or reset.
  if (account && !recoveryCode) return <Navigate to="/" replace />;
  return (
    <main id="main" className="public">
      <div className="public-intro">
        <div className="brand brand-large">
          <Logo />
          <span>Bill Splitter</span>
        </div>
        <p className="public-lede">Split any bill to the exact cent, then keep a running tab with friends.</p>
        <div className="sample-receipt" aria-hidden="true">
          <p className="sample-title">Weekend trip</p>
          <dl>
            <div>
              <dt>Cabin, 2 nights</dt>
              <dd>$120.00</dd>
            </div>
            <div>
              <dt>Fuel</dt>
              <dd>$30.00</dd>
            </div>
            <div>
              <dt>Tax 10%</dt>
              <dd>$15.00</dd>
            </div>
            <div className="sample-total">
              <dt>Total</dt>
              <dd>$165.00</dd>
            </div>
          </dl>
          <ul className="sample-split">
            <li>Ali pays $55.00</li>
            <li>Sara pays $55.00</li>
            <li>Omar pays $55.00</li>
          </ul>
        </div>
      </div>
      <div className="public-card">
        <Outlet />
      </div>
    </main>
  );
}
