import React, { Component } from 'react';
import { MaxesForm } from './MaxesForm'
import './App.css';

class App extends Component {
  render() {
    return (
      <div className="App">
        <header>
          <link 
            rel="stylesheet"
            href="https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0/css/bootstrap.min.css"
            integrity="sha384-Gn5384xqQ1aoWXA+058RXPxPg6fy4IWvTNh0E263XmFcJlSAwiGgFAW/dAiS6JXm"
            crossorigin="anonymous">
          </link>
        </header>
        <body>
          <RoutineGenerator />
        </body>
      
       
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
