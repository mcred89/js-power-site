import React, { Component } from 'react';
import { MaxesForm } from './MaxesForm'
import './App.css';

class App extends Component {
  render() {
    return (
      <div className="App">
       <RoutineGenerator />
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
