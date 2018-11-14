import React, { Component } from 'react';

export class MaxesForm extends Component {

    constructor(props) {
        super(props);
        this.state = {
            maxSquat: '',
            maxPress: '',
            maxDead: '',
            mainliftchoice: 'low',
            needsToFillOutForm: true,
            percentages: {
                'low': {
                    0: {"percent": .65, "reprange": "4x6"},
                    1: {"percent": .7, "reprange": "4x5"},
                    2: {"percent": .75, "reprange": "4x4"},
                    3: {"percent": .8, "reprange": "4x3"},
                    4: {"percent": .85, "reprange": "4x2"}
                },
                'high': {
                    0: {"percent": .55, "reprange": "5x10"},
                    1: {"percent": .6, "reprange": "5x9"},
                    2: {"percent": .65, "reprange": "5x8"},
                    3: {"percent": .7, "reprange": "5x7"},
                    4: {"percent": .75, "reprange": "5x6"}
                }
            }
        };

        this.handleChange = this.handleChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
    }

    handleChange(event) {
        const target = event.target;
        const value = target.value;
        const name = target.name;
        this.setState({[name]: value},()=>{return false;});
    }

    handleSubmit() {
        this.setState({
            needsToFillOutForm: false
        });
    }

    get form() {
        return (
            <form onSubmit={this.handleSubmit}>
                <div className="form-group">
                    <h2>Input Maxes</h2>
                    <input 
                        type="number"
                        className="form-control"
                        value={this.state.maxSquat}
                        name="maxSquat"
                        placeholder="Squat"
                        onChange={this.handleChange}
                        required
                        min="1" max="1000"
                    />
                    <input 
                        type="number" 
                        className="form-control"
                        value={this.state.maxPress}
                        name="maxPress"
                        placeholder="Press"
                        onChange={this.handleChange}
                        required
                        min="1" max="1000"
                    />
                    <input
                        type="number"
                        className="form-control"
                        value={this.state.maxDead}
                        name="maxDead"
                        placeholder="Deadlift"
                        onChange={this.handleChange}
                        required
                        min="1" max="1000"
                    />

                    <h2>Volume</h2>
                    <div className="btn-group btn-group-toggle" data-toggle="buttons" onChange={this.handleChange}>
                    <label className="btn btn-secondary">
                        Low
                        <input 
                            type="radio"
                            className="optradio form-control" 
                            value="low"
                            name="mainliftchoice"
                            checked={this.state.mainliftchoice === "low"}
                            onChange={this.handleChange}
                            required
                        />
                    </label>
                    <label className="btn btn-secondary">
                        High
                        <input 
                            type="radio"
                            className="optradio form-control"
                            value="high"
                            name="mainliftchoice"
                            checked={this.state.mainliftchoice === "high"}
                            onChange={this.handleChange}
                        />
                    </label>
                    </div>
                    <div>
                        <button type="submit" className="button btn btn-primary mt-3">Submit</button>
                    </div>
                </div>
            </form>       
        )
    }

    createRoutine = () => {
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
                let volume = this.state.mainliftchoice;
                let percent = this.state.percentages[volume][i]['percent'];
                let reps = this.state.percentages[volume][i]['reprange'];
                lifts.push(
                    <li>
                        {`${warmup}`}
                    </li>
                )
                lifts.push(
                    <li>
                        {`${mainLift}: ${Math.ceil(mainLiftMax * percent / 5) * 5}lbs ${reps}`}
                    </li>
                )
                if ( j !== 0 ) {
                    lifts.push(
                        <li>
                            {`${accessory}: ${Math.ceil(mainLiftMax * .4 / 5) * 5}lbs ${accessoryReps}`}
                        </li>
                    )
                }
                weekArray.push(<div><h4>Day {day}</h4><ul>{lifts}</ul></div>)
            }

            routine.push(<div><h3>Week {week}</h3>{weekArray}</div>)
        }

        return routine;
    }

    get routine() {
        return(
            <div className="text-white">
                <h1>Your Workout Program</h1>
                <hr />
                <ul>{this.createRoutine()}</ul>
            </div>
        )
    }

    render() {
        return (
            <div>
                {this.state.needsToFillOutForm ? (
                    <div>
                        <div className="card mt-5">
                            <div className="card-body">{this.form}</div>
                        </div>
                    </div>
                ) : (
                    <div>{this.routine}</div>
                )}
            </div>
        );
      }
    }
