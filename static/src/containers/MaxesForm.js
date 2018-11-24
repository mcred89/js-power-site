import React, { Component } from 'react';
import RadioOrCheckGroup from '../components/RadioOrCheckGroup';
import NumberInput from '../components/NumberInput';
import Routine from '../components/RoutineGenerator';

export class MaxesForm extends Component {

    constructor(props) {
        super(props);
        this.state = {
            maxSquat: '',
            maxPress: '',
            maxDead: '',
            mainLiftChoices: ['Low', 'High'],
            mainLiftChoice: ['Low'],
            needsToFillOutForm: true
        };

        this.handleChange = this.handleChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
    }

    handleChange(event) {
        const target = event.target;
        const value = target.value;
        const name = target.name;
        this.setState({[name]: value});
    }

    handleSubmit(event) {
        console.log('mainLiftChoice', this.state.mainLiftChoice)
        this.setState({
            needsToFillOutForm: false
        });
    }

    render() {
        return (
            <div>
                {this.state.needsToFillOutForm ? (
                    <form className="form-group card mt-5" onSubmit={this.handleSubmit}>
                        <div className="card-body">
                            <h2>Input Maxes</h2>
                            <NumberInput
                                name={'maxSquat'}
                                controlFunc={this.handleChange}
                                content={this.state.maxSquat}
                                placeholder={'Squat'}
                                min={1}
                                max={1001} />
                            <NumberInput
                                name={'maxPress'}
                                controlFunc={this.handleChange}
                                content={this.state.maxPress}
                                placeholder={'Press'}
                                min={1}
                                max={1001} />
                            <NumberInput
                                name={'maxDead'}
                                controlFunc={this.handleChange}
                                content={this.state.maxDead}
                                placeholder={'Dead'}
                                min={1}
                                max={1001} />
                            <RadioOrCheckGroup
                                title={'Volume'}
					            setName={'mainLiftChoice'}
					            controlFunc={this.handleChange}
					            type={'radio'}
					            options={this.state.mainLiftChoices} />
                            <button
                                type="submit"
                                className="button btn btn-primary mt-3">Submit</button>
                        </div>
                    </form>
                ) : (
                    <Routine 
                        maxSquat={this.state.maxSquat}
                        maxPress={this.state.maxPress}
                        maxDead={this.state.maxDead}
                        mainLiftChoice={this.state.mainLiftChoice} />
                )}
            </div>
        );
      }
    }
