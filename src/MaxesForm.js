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

    createRoutine = (percentages) => {
        let routine = [];

        for (let i = 0; i < 5; i++) {
            let week = i + 1
            let weekArray = []

            for (let j = 0; j < 3; j++) {
                let mainLift;
                let warmup;
                let accessory;
                let accessoryReps;
                let mainLiftMax;
                let day = j +1
                let lifts = []
                if (j === 0) {
                    mainLift = 'Squat';
                    mainLiftMax = this.state.maxSquat;
                    warmup = 'Barbell Overhead Squat x 30';
                    accessory = 'Zercher Squats';
                    accessoryReps = '3x5'
                } else if (j === 1) {
                    mainLift = 'Press';
                    mainLiftMax = this.state.maxPress;
                    warmup = '50 LB KB Press x 15(each arm)';
                    accessory = 'Curls';
                    accessoryReps = '3x8'
                } else {
                    mainLift = 'Deadlift';
                    mainLiftMax = this.state.maxDead;
                    warmup = 'Barbell Overhead Squat x 30';
                    accessory = 'Bent Over Row';
                    accessoryReps = '3x5'
                }
                lifts.push(
                    <li>
                        {`${warmup}`}
                    </li>
                )
                lifts.push(
                    <li>
                        {`${mainLift}: ${mainLiftMax * percentages[i]['percent']}lbs ${percentages[i]['reprange']}`}
                    </li>
                )
                if ( j !== 0 ) {
                    lifts.push(
                        <li>
                            {`${accessory}: ${mainLiftMax * .4}lbs ${accessoryReps}`}
                        </li>
                    )
                }
                weekArray.push(<div><h4>Day {day}</h4><ul>{lifts}</ul></div>)
            }

            routine.push(<div><h3>Week {week}</h3>{weekArray}</div>)
        }

        return routine;
    }
    

    render() {
        const needsToFillOutForm = this.state.needsToFillOutForm;
        let percentages;
        if (this.state.mainliftchoice === 'low') {
            percentages = {
                0: {"percent": .65, "reprange": "4x6"},
                1: {"percent": .7, "reprange": "4x5"},
                2: {"percent": .75, "reprange": "4x4"},
                3: {"percent": .8, "reprange": "4x3"},
                4: {"percent": .85, "reprange": "4x2"}
            }
        } else {
            percentages = {
                0: {"percent": .55, "reprange": "5x10"},
                1: {"percent": .6, "reprange": "5x9"},
                2: {"percent": .65, "reprange": "5x8"},
                3: {"percent": .7, "reprange": "5x7"},
                4: {"percent": .75, "reprange": "5x6"}
            }
        };

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
                        <h1>Your Workout Program</h1>
                        <hr />
                        <ul>{this.createRoutine(percentages)}</ul>
                    </div>
                )}
            </div>
        );
      }
    }
