import React from 'react';
import { HashRouter as Router, Link, Route, Routes } from 'react-router-dom';
import { MaxesForm } from '../containers/MaxesForm';

const AppearanceControl = ({ appearance, onChange }) => (
  <label className="form-field appearance-control">
    <span className="field-label">Appearance</span>
    <select className="number-input" value={appearance} onChange={event => onChange(event.target.value)}>
      <option value="system">Use device setting</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>
);

const CalculatorWebsite = ({ appearance, onAppearanceChange }) => (
  <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <div className="site-shell">
      <header className="site-header">
        <nav className="nav-wrap" aria-label="Main navigation">
          <Link className="brand" to="/">
            <span className="brand-mark">TM</span>
            <span>The McIlroy Method</span>
          </Link>
          <AppearanceControl appearance={appearance} onChange={onAppearanceChange} />
        </nav>
      </header>
      <main className="site-main">
        <Routes>
          <Route path="/" element={<MaxesForm />} />
          <Route path="*" element={<MaxesForm />} />
        </Routes>
      </main>
      <footer className="site-footer">Built for steady progress, one session at a time.</footer>
    </div>
  </Router>
);

export default CalculatorWebsite;
