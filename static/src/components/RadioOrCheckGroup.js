import React from 'react';
import PropTypes from 'prop-types';

const RadioOrCheckGroup = (props) => (
  <fieldset className="option-group">
    <legend className="option-title">{props.title}</legend>
    <div className={`option-list ${props.options.length > 2 ? 'four-up' : ''}`}>
      {props.options.map(option => (
        <label key={option} className="option-label">
          <input
            className="option-input"
            required
            name={props.setName}
            value={option}
            type={props.type}
            checked={props.selectedValue === option}
            onChange={props.controlFunc}
          />
          <span className="option-text">{option}</span>
        </label>
      ))}
    </div>
  </fieldset>
);

RadioOrCheckGroup.propTypes = {
  title: PropTypes.string.isRequired,
  type: PropTypes.oneOf(['checkbox', 'radio']).isRequired,
  setName: PropTypes.string.isRequired,
  options: PropTypes.array.isRequired,
  controlFunc: PropTypes.func.isRequired,
  selectedValue: PropTypes.string,
};

export default RadioOrCheckGroup;
