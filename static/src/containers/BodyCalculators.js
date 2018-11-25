import React, { Component } from 'react';
import NumberInput from '../components/NumberInput';
import RadioOrCheckGroup from '../components/RadioOrCheckGroup';
import TDEEOutput from '../components/TDEECalculator'
import FFMIOutput from '../components/MassIndexCalc'

export class BodyCalc extends Component {
    constructor(props) {
        super(props);
        this.state = {
            weight: '',
            height: '',
            age: '',
            bodayFat: '',
            sexChoices: ['Male', 'Female'],
            sex: [],
            activityChoices: ['None', 'Light', 'Moderate', 'Very'],
            activity: [],
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

    handleSubmit(values) {
        values.preventDefault()
        this.setState({
            needsToFillOutForm: false
        });
        
    }

    render() {
        return (
            <div className="">
                <div className="card bg-dark text-white m-5">
                    <form className="card-body form-group" onSubmit={this.handleSubmit}>
                        <h2>Metabolic Calculator</h2>
                        <NumberInput
                            name={'weight'}
                            controlFunc={this.handleChange}
                            content={this.state.weight}
                            placeholder={'Weight in Pounds'}
                            min={1}
                            max={600} />
                        <NumberInput
                            name={'bodayFat'}
                            controlFunc={this.handleChange}
                            content={this.state.bodayFat}
                            placeholder={'Body Fat Percentage'}
                            min={1}
                            max={600} />
                        <NumberInput
                            name={'height'}
                            controlFunc={this.handleChange}
                            content={this.state.height}
                            placeholder={'Height in Inches'}
                            min={1}
                            max={100} />
                        <NumberInput
                            name={'age'}
                            controlFunc={this.handleChange}
                            content={this.state.age}
                            placeholder={'Age in Years'}
                            min={1}
                            max={150} />
                        <RadioOrCheckGroup
                            title={'Sex'}
					        setName={'sex'}
					        controlFunc={this.handleChange}
					        type={'radio'}
					        options={this.state.sexChoices} />
                        <RadioOrCheckGroup
                            title={'Activity Level'}
					        setName={'activity'}
					        controlFunc={this.handleChange}
					        type={'radio'}
					        options={this.state.activityChoices} />
                        <button
                            type="submit"
                            className="button btn btn-primary mt-3">Submit</button>
                    </form>
                {this.state.needsToFillOutForm ? (<div/>) : (
                    <div className="card-footer">
                        <TDEEOutput 
                            weight={this.state.weight}
                            height={this.state.height}
                            age={this.state.age}
                            sex={this.state.sex}
                            activity={this.state.activity}
                        />
                        <hr/>
                        <FFMIOutput 
                            weight={this.state.weight}
                            height={this.state.height}
                            bodayFat={this.state.bodayFat}
                        />
                        <hr/>
                        <p>See 'About' page for more info.</p>
                    </div>
                 )}
                </div>
            </div>
        )
    }
}