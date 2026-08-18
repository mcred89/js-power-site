import React, { Component } from 'react';
import RadioOrCheckGroup from '../components/RadioOrCheckGroup';
import NumberInput from '../components/NumberInput';
import Routine from '../components/RoutineGenerator';

const eventLifts = [
  { key: 'squat', label: 'Squat' },
  { key: 'press', label: 'Press' },
  { key: 'deadlift', label: 'Deadlift' },
];

export class MaxesForm extends Component {
  constructor(props) {
    super(props);
    this.state = {
      maxSquat: '',
      maxPress: '',
      maxDead: '',
      mainLiftChoices: ['Low', 'High'],
      mainLiftChoice: '',
      durationChoices: ['3 weeks', '5 weeks'],
      duration: '5 weeks',
      mesoMode: false,
      microCycles: [
        { duration: '5 weeks', volume: 'Low' },
        { duration: '5 weeks', volume: 'Low' },
      ],
      squatIncrement: '10',
      pressIncrement: '5',
      deadliftIncrement: '10',
      includeStrongmanDay: false,
      includeBackoffSets: false,
      squatEventEnabled: false,
      squatEventMovement: '',
      squatEventSets: '',
      squatEventReps: '',
      pressEventEnabled: false,
      pressEventMovement: '',
      pressEventSets: '',
      pressEventReps: '',
      deadliftEventEnabled: false,
      deadliftEventMovement: '',
      deadliftEventSets: '',
      deadliftEventReps: '',
      needsToFillOutForm: true,
    };
    this.handleChange = this.handleChange.bind(this);
    this.handleCheckbox = this.handleCheckbox.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
    this.resetForm = this.resetForm.bind(this);
    this.handleCycleChange = this.handleCycleChange.bind(this);
    this.addCycle = this.addCycle.bind(this);
  }

  handleChange(event) {
    this.setState({ [event.target.name]: event.target.value });
  }

  handleCheckbox(event) {
    this.setState({ [event.target.name]: event.target.checked });
  }

  handleCycleChange(event) {
    const cycleIndex = Number(event.target.dataset.cycleIndex);
    const field = event.target.name;
    const microCycles = this.state.microCycles.map((cycle, index) => (
      index === cycleIndex ? { ...cycle, [field]: event.target.value } : cycle
    ));
    this.setState({ microCycles });
  }

  addCycle() {
    this.setState(state => ({
      microCycles: [...state.microCycles, { duration: '5 weeks', volume: 'Low' }],
    }));
  }

  removeCycle(cycleIndex) {
    this.setState(state => ({
      microCycles: state.microCycles.filter((cycle, index) => index !== cycleIndex),
    }));
  }

  handleSubmit(event) {
    event.preventDefault();
    if (this.props.onCreate) {
      this.props.onCreate(this.state);
      return;
    }
    this.setState({ needsToFillOutForm: false });
  }

  resetForm() {
    this.setState({ needsToFillOutForm: true });
  }

  renderEventFields(eventLift) {
    const enabledName = `${eventLift.key}EventEnabled`;
    const enabled = this.state[enabledName];

    return (
      <div className="event-option" key={eventLift.key}>
        <label className="check-label">
          <input
            type="checkbox"
            name={enabledName}
            checked={enabled}
            onChange={this.handleCheckbox}
          />
          <span>Add a Strongman event to {eventLift.label} day</span>
        </label>
        {enabled && (
          <div className="event-fields">
            <label className="form-field event-movement">
              <span className="field-label">Movement</span>
              <input
                className="number-input"
                type="text"
                name={`${eventLift.key}EventMovement`}
                value={this.state[`${eventLift.key}EventMovement`]}
                onChange={this.handleChange}
                placeholder="e.g. Farmer's carry"
                required
              />
            </label>
            <NumberInput
              name={`${eventLift.key}EventSets`}
              label="Sets"
              controlFunc={this.handleChange}
              content={this.state[`${eventLift.key}EventSets`]}
              min={1}
              max={20}
            />
            <NumberInput
              name={`${eventLift.key}EventReps`}
              label="Reps"
              controlFunc={this.handleChange}
              content={this.state[`${eventLift.key}EventReps`]}
              min={1}
              max={100}
            />
          </div>
        )}
      </div>
    );
  }

  render() {
    if (!this.state.needsToFillOutForm && !this.props.onCreate) {
      return <Routine {...this.state} onReset={this.resetForm} />;
    }

    return (
      <div className="page routine-form-page">
        <form className="panel" onSubmit={this.handleSubmit}>
          <div className="panel-header">
            <h2 className="panel-title">Build your routine</h2>
            <p className="panel-subtitle">Use pounds. Your maxes should reflect a recent, clean rep.</p>
          </div>
          {this.props.onCancel && <button className="text-button form-cancel" type="button" onClick={this.props.onCancel}>← Cancel</button>}
          <div className="field-grid three-fields">
            <NumberInput name="maxSquat" label="Squat max" controlFunc={this.handleChange} content={this.state.maxSquat} placeholder="e.g. 315" min={1} max={1001} />
            <NumberInput name="maxPress" label="Press max" controlFunc={this.handleChange} content={this.state.maxPress} placeholder="e.g. 225" min={1} max={1001} />
            <NumberInput name="maxDead" label="Deadlift max" controlFunc={this.handleChange} content={this.state.maxDead} placeholder="e.g. 405" min={1} max={1001} />
          </div>
          <div className="option-group">
            <label className="check-label standalone-check">
              <input type="checkbox" name="mesoMode" checked={this.state.mesoMode} onChange={this.handleCheckbox} />
              <span>Build a mesocycle from multiple cycles</span>
            </label>
          </div>
          {!this.state.mesoMode && (
            <React.Fragment>
              <RadioOrCheckGroup title="Training volume" setName="mainLiftChoice" controlFunc={this.handleChange} type="radio" options={this.state.mainLiftChoices} selectedValue={this.state.mainLiftChoice} />
              <RadioOrCheckGroup title="Routine length" setName="duration" controlFunc={this.handleChange} type="radio" options={this.state.durationChoices} selectedValue={this.state.duration} />
            </React.Fragment>
          )}
          {this.state.mesoMode && (
            <fieldset className="mesocycle-group">
              <legend className="option-title">Microcycles</legend>
              <p className="field-help">Choose the length and volume of each block. The percentages restart with every block.</p>
              <div className="cycle-list">
                {this.state.microCycles.map((cycle, cycleIndex) => (
                  <div className="cycle-row" key={cycleIndex}>
                    <span className="cycle-label">Cycle {cycleIndex + 1}</span>
                    <select className="select-input" name="duration" data-cycle-index={cycleIndex} value={cycle.duration} onChange={this.handleCycleChange}>
                      {this.state.durationChoices.map(choice => <option key={choice}>{choice}</option>)}
                    </select>
                    <select className="select-input" name="volume" data-cycle-index={cycleIndex} value={cycle.volume} onChange={this.handleCycleChange}>
                      {this.state.mainLiftChoices.map(choice => <option key={choice}>{choice}</option>)}
                    </select>
                    <button className="remove-cycle" type="button" onClick={() => this.removeCycle(cycleIndex)} disabled={this.state.microCycles.length === 1} aria-label={`Remove cycle ${cycleIndex + 1}`}>Remove</button>
                  </div>
                ))}
              </div>
              <button className="add-cycle" type="button" onClick={this.addCycle}>+ Add microcycle</button>
              <div className="increment-section">
                <p className="option-title">Max increase after each microcycle</p>
                <div className="field-grid three-fields">
                  <NumberInput name="squatIncrement" label="Squat increase" controlFunc={this.handleChange} content={this.state.squatIncrement} min={0} max={100} />
                  <NumberInput name="pressIncrement" label="Press increase" controlFunc={this.handleChange} content={this.state.pressIncrement} min={0} max={100} />
                  <NumberInput name="deadliftIncrement" label="Deadlift increase" controlFunc={this.handleChange} content={this.state.deadliftIncrement} min={0} max={100} />
                </div>
              </div>
            </fieldset>
          )}
          {(this.state.mainLiftChoice === 'Low' || (this.state.mesoMode && this.state.microCycles.some(cycle => cycle.volume === 'Low'))) && (
            <div className="option-group nested-option">
              <label className="check-label standalone-check">
                <input type="checkbox" name="includeBackoffSets" checked={this.state.includeBackoffSets} onChange={this.handleCheckbox} />
                <span>Include three descending back-off sets</span>
              </label>
              <p className="field-help backoff-help">Three descending sets of 8, 12, and 15 reps, with weight capped as the main work gets heavier.</p>
            </div>
          )}
          <div className="option-group">
            <label className="check-label standalone-check">
              <input type="checkbox" name="includeStrongmanDay" checked={this.state.includeStrongmanDay} onChange={this.handleCheckbox} />
              <span>Include a dedicated Strongman day</span>
            </label>
          </div>
          <fieldset className="event-group">
            <legend className="option-title">Strongman events <span className="optional-label">Optional</span></legend>
            <p className="field-help">Add your own event to any main-lift day.</p>
            {eventLifts.map(eventLift => this.renderEventFields(eventLift))}
          </fieldset>
          <button type="submit" className="primary-button">Generate plan <span aria-hidden="true">→</span></button>
        </form>
      </div>
    );
  }
}
