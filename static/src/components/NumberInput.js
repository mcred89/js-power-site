import React from 'react';
import PropTypes from 'prop-types';

const NumberInput = (props) => (
  <label className="form-field">
    <span className="field-label">{props.label}</span>
    <input className="number-input" type='number' required name={props.name} value={props.content}
      onChange={props.controlFunc} placeholder={props.placeholder} min={props.min} max={props.max} />
  </label>
);

NumberInput.propTypes = {
  name: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  controlFunc: PropTypes.func.isRequired,
  content: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  placeholder: PropTypes.string,
  min: PropTypes.number,
  max: PropTypes.number,
};

export default NumberInput;
