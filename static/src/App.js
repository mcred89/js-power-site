import React, { Component } from 'react';
import { HashRouter as Router, Route, Routes, Link } from 'react-router-dom';
import { MaxesForm } from './containers/MaxesForm';
import './App.css';

class App extends Component {
  render() {
    return (
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <div className="site-shell">
          <NavBar />
          <main className="site-main">
            <Routes>
              <Route path='/' element={<MaxesForm />} />
              <Route path='*' element={<MaxesForm />} />
            </Routes>
          </main>
          <footer className="site-footer">Built for steady progress, one session at a time.</footer>
        </div>
      </Router>
    );
  }
}

class NavBar extends Component {
  render() {
    return (
      <header className="site-header">
        <nav className="nav-wrap" aria-label="Main navigation">
          <Link className="brand" to="/">
            <span className="brand-mark">TM</span>
            <span>The McIlroy Method</span>
          </Link>
        </nav>
      </header>
    );
  }
}

export default App;
