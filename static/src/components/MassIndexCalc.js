import React from 'react';

const FFMICalculator = (props) => {
    let weight = props.weight;
    let height = props.height;
    let bodayFat = props.bodayFat;
    let totalBodyFat;
    let leanMass;
    let ffmi;
    let adjFFMI;
    let bmi;

    totalBodyFat = weight * (bodayFat / 100)
    leanMass = weight * (1 - (bodayFat / 100))
    ffmi = (leanMass / 2.2) / ((height * 0.0254) ** 2)
    adjFFMI = Math.ceil(ffmi + ( 6.3 * (1.8 - (height * 0.0254))))

    bmi = Math.ceil((703 * weight) / (height ** 2))

    return [adjFFMI, Math.ceil(totalBodyFat), Math.ceil(leanMass), bmi]
}

const FFMIOutput = (props) => (
    <div>
        <h3>FFMI: {FFMICalculator(props)[0]}</h3>
        <h3>Body Fat: {FFMICalculator(props)[1]}lbs</h3>
        <h3>Lean Mass: {FFMICalculator(props)[2]}lbs</h3>
        <h3>BMI: {FFMICalculator(props)[3]}</h3>
    </div>
)

export default FFMIOutput;