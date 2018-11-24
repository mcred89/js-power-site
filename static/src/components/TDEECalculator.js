import React from 'react';

const TDEECalculator = (props) => {
    let weight = props.weight;
    let height = props.height;
    let age = props.age;
    let sex = props.sex;
    let activity = props.activity;
    let activity_multiplier;
    let bmr;
    let tdee;

    if (activity === 'None') {
        activity_multiplier = 1.2;
    } else if (activity === 'Light') {
        activity_multiplier = 1.375;
    } else if (activity === 'Moderate') {
        activity_multiplier = 1.55;
    } else {
        activity_multiplier = 1.725;
    }

    if (sex === 'Male') {
        bmr =  Math.ceil(66 + (6.23 * weight) + ( 12.7 * height) - (6.8 * age))
    } else {
        bmr = Math.ceil(655 + (4.35 * weight) + (4.7 * height) - (4.7 * age))
    }

    tdee = Math.ceil(bmr * activity_multiplier)
    return [bmr, tdee]
}

const TDEEOutput = (props) => (
    <div>
        <h3>BMR: {TDEECalculator(props)[0]}</h3>
        <h3>TDEE: {TDEECalculator(props)[1]}</h3>
        <p>See 'About' page for more info.</p>
    </div>
)

export default TDEEOutput;