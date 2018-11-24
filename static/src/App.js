import React, { Component } from 'react';
import { MaxesForm } from './containers/MaxesForm'

class App extends Component {
  render() {
    return (
      <div className="App container">
          <div className="row">
            <div className="col-4"></div>
              <MaxesForm />
            <div className="col-4"></div>
          </div>
      </div>
    );
  }
}

export default App;
