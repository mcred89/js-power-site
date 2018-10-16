import React, { Component } from 'react';

export class MaxesForm extends Component {

    constructor(props) {
        super(props);
        this.state = {
            maxSquat: 0,
            maxPress: 0,
            maxDead: 0,
            mainliftchoice: 'low',
            needsToFillOutForm: true
        };

        this.handleChange = this.handleChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
      }

      handleChange(event) {
        const target = event.target;
        const value = target.value
        const name = target.name;
    
        this.setState({
          [name]: value
        });
      }

    handleSubmit(event) {
        this.setState({
            needsToFillOutForm: false
        });
      }
    

    render() {
        const needsToFillOutForm = this.state.needsToFillOutForm;

        return (
            <div>
                {needsToFillOutForm ? (
                    <div>
                        <form onSubmit={this.handleSubmit}>
                            <div className="form-group">
                                <label>Input Maxes</label>
                                <input type="number" className="form-control" value={this.state.maxSquat} name="maxSquat" placeholder="Max Squat" onChange={this.handleChange}/>
                                <input type="number" className="form-control" value={this.state.maxPress} name="maxPress" placeholder="Max Press" onChange={this.handleChange}/>
                                <input type="number" className="form-control" value={this.state.maxDead} name="maxDead" placeholder="Max Deadlift" onChange={this.handleChange}/>
                            </div>
                            <div className="form-group">
                                <label>Low Volume</label>
                                <input type="radio" class="form-check-input" name="mainliftchoice" value="low" checked />
                                <label>High Volume</label>
                                <input type="radio" class="form-check-input" name="mainliftchoice" value="high" />
                            </div>
                            <div>
                                <input type="submit" value="Submit" class="button btn btn-primary" />
                            </div>
                        </form>
                    </div>
                ) : (
                    <div>
                        <ul>
                            <li>{this.state.maxSquat}</li>
                            <li>{this.state.maxPress}</li>
                            <li>{this.state.maxDead}</li>
                        </ul>
                        
                    </div>
                )}
            </div>
        );
      }
    }
