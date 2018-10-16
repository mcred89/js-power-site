import React, { Component } from 'react';

export class MaxesForm extends Component {

    constructor(props) {
        super(props);
        this.state = {
            maxSquat: 0,
            maxPress: 0,
            maxDead: 0,
            mainliftchoice: 'low'
        };

        this.handleInputChange = this.handleInputChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
      }

      handleInputChange(event) {
        const target = event.target;
        const value = target.value;
        const name = target.name;
        this.setState({
            [name]: value
        });
      }

      handleSubmit(event) {
        alert(this.state.maxSquat + ' ' + this.state.maxPress + ' ' + this.state.maxDead + this.state.mainliftchoice);
      }
    

    render() {
        return (
            <form>
                <div className="form-group">
                    <label>Input Maxes</label>
                    <input type="number" className="form-control" name="maxSquat" placeholder="Max Squat" />
                    <input type="number" className="form-control" name="maxPress" placeholder="Max Press" />
                    <input type="number" className="form-control" name="maxDead" placeholder="Max Deadlift" />
                </div>
                <div className="form-group">
                    <label>Low Volume</label>
                    <input type="radio" class="form-check-input" name="mainliftchoice" value="low" checked />
                    <label>High Volume</label>
                    <input type="radio" class="form-check-input" name="mainliftchoice" value="high" />
                </div>
                <div>
                    <button type="submit" value="Submit" class="button btn btn-primary">Submit</button>
                </div>
            </form>
        );
      }
    }
