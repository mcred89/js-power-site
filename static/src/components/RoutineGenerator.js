import React from 'react';

const createRoutine = (props) => {
    var percentages = {
        'Low': {
            0: {"percent": .65, "reprange": "4x6"},
            1: {"percent": .7, "reprange": "4x5"},
            2: {"percent": .75, "reprange": "4x4"},
            3: {"percent": .8, "reprange": "4x3"},
            4: {"percent": .85, "reprange": "4x2"}
        },
        'High': {
            0: {"percent": .55, "reprange": "5x10"},
            1: {"percent": .6, "reprange": "5x9"},
            2: {"percent": .65, "reprange": "5x8"},
            3: {"percent": .7, "reprange": "5x7"},
            4: {"percent": .75, "reprange": "5x6"}
        }
    }
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
                mainLiftMax = props.maxSquat;
                warmup = 'Barbell Overhead Squat x 30';
                accessory = 'Zercher Squats';
                accessoryReps = '3x5'
            } else if (j === 1) {
                mainLift = 'Press';
                mainLiftMax = props.maxPress;
                warmup = '50 LB KB Press x 15(each arm)';
                accessory = 'Curls';
                accessoryReps = '3x8'
            } else {
                mainLift = 'Deadlift';
                mainLiftMax = props.maxDead;
                warmup = 'Barbell Overhead Squat x 30';
                accessory = 'Bent Over Row';
                accessoryReps = '3x5'
            }
            let volume = props.mainLiftChoice;
            let percent = percentages[volume][i]['percent'];
            let reps = percentages[volume][i]['reprange'];
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

const Routine = (props) => (

    <div className="text-white">
        <h1>Your Workout Program</h1>
        <hr />
        <ul>{createRoutine(props)}</ul>
    </div>

);

export default Routine;