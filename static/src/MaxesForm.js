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
            },
            errorMessage: ''
        };

        this.handleInputChange = this.handleInputChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
    }

    validate(name, value) {
        const liftVars = ['maxSquat', 'maxPress', 'maxDead'];
        if (liftVars.includes(name)) {
            if (value <= 0 || value > 1001){
                this.setState({errorMessage: 'Your maxes must be between 1 and 1000'});
            } else if (this.liftsAreValid()){
                this.clearError()
            }
        }
    };

    liftsAreValid() {
        const liftVarValues = [this.state.maxSquat, this.state.maxPress, this.state.maxDead];
        let i = 0;
        for (i = 0; i < liftVarValues.length; i++) {
            let value = liftVarValues[i]
            if ( value > 0 && value < 1001 ) {
                this.clearError()
            } else if (value === '') {
                this.clearError()
            } else {
                this.setState({errorMessage: 'Your maxes must be between 1 and 1000'});
                return false       
            }
        }
        return true
    }

    handleInputChange(event) {
        const target = event.target;
        const value = target.value;
        const name = target.name;
        this.setState({[name]: value}, this.validate(name, value));
    }

    handleSubmit() {
        if ( this.liftsAreValid() ) {
            this.setState({
                needsToFillOutForm: false
            });
        }
    }

    clearError() {
        this.setState({
            errorMessage: ''
        });
    }

    get error() {
        if (this.state.errorMessage !== '') {
            return (
                <div className="alert alert-danger" role="alert">
                    {this.state.errorMessage}
                </div>
            )
        } else {
            return (<div></div>)   
        }
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
                        onChange={this.handleInputChange}
                        required
                    />
                    <input 
                        type="number" 
                        className="form-control"
                        value={this.state.maxPress}
                        name="maxPress"
                        placeholder="Press"
                        onChange={this.handleInputChange}
                        required
                    />
                    <input
                        type="number"
                        className="form-control"
                        value={this.state.maxDead}
                        name="maxDead"
                        placeholder="Deadlift"
                        onChange={this.handleInputChange}
                        required
                    />

                    <h2>Volume</h2>
                    <div className="btn-group btn-group-toggle" data-toggle="buttons">
                    <label className="btn btn-secondary">
                        Low
                        <input 
                            type="radio"
                            className="optradio" 
                            name="mainliftchoice"
                            value="low" 
                            onChange={this.handleInputChange}
                            autoComplete="off"
                            required
                        />
                    </label>
                    <label className="btn btn-secondary">
                        High
                        <input 
                            type="radio"
                            className="optradio"
                            name="mainliftchoice"
                            value="high"
                            onChange={this.handleChange}
                            autoComplete="off"
                            required
                        />
                    </label>
                    </div>
                    <div>
                        <button disabled={this.state.errorMessage} type="submit" value="Submit" className="button btn btn-primary mt-3">Submit</button>
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
                let percent = this.state.percentages[this.state.mainliftchoice][i]['percent'];
                let reps = this.state.percentages[this.state.mainliftchoice][i]['reprange'];
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
                            <div className="card-footer">{this.error}</div>
                        </div>
                    </div>
                ) : (
                    <div>{this.routine}</div>
                )}
            </div>
        );
      }
    }
