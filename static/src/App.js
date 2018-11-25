import React, { Component } from 'react';
import { MaxesForm } from './containers/MaxesForm';
import { BodyCalc } from './containers/BodyCalculators';
import { About } from './containers/About';
import { BrowserRouter as Router, Route, Switch, Link } from 'react-router-dom';

class App extends Component {
  render() {
    return (
      <div>
          <Router>
            <div>
              <NavBar />
              <Switch>
                <Route exact path='/' component={MaxesForm} />
                <Route exact path='/about' component={About} />
                <Route path='/calculators' component={BodyCalc} />
              </Switch>
            </div>
          </Router>
      </div>
    );
  }
}

class NavBar extends Component {
  render() {
    return (
      <div>
      <nav className="navbar navbar-expand-lg navbar-dark  bg-dark">
        <Link className="navbar-brand" to="/">TheMcIlroy</Link>
        <ul className="navbar-nav">
          <li className="nav-item">
            <Link className="nav-link" to="/about">About</Link>
          </li>
          <li className="nav-item">
            <Link className="nav-link" to="/">Routine</Link>
          </li>
          <li className="nav-item">
            <Link className="nav-link" to="/calculators">Calculators</Link>
          </li>
        </ul>
      </nav>
    </div>
    )
  }
}

export default App;
