import React, { Component } from 'react';
import { MaxesForm } from './MaxesForm'

class App extends Component {
  render() {
    return (
      <div className="App container">
          <div className="row">
            <div className="col-4"></div>
              <RoutineGenerator />
            <div className="col-4"></div>
          </div>
      </div>
    );
  }
}

class RoutineGenerator extends Component {
  render() {
    return (
      <div>
       <MaxesForm />
      </div>
    );
  }
}

export default App;
