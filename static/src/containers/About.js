import React, { Component } from 'react';

export class About extends Component {
    render() {
        return (
            <div className="text-white m-5">
                <h1>General</h1>
                <p>
                    I use this site to learn and play with new tech, but I also actually use
                    it to plan my workout routines and diets. Here I'll be noting how to use
                    the individual pieces of the site.

                    Just to add some (whatever minor) credability to my incoming ramblings:
                </p>
                <ul>
                    <li>
                        I've been nerding out about lifting for 16 years.
                    </li>
                    <li>
                        I have a horrible back that I've learned to work around. I herniated my
                        first disk at 14 years old and had back surgery when I was 22. I haven't
                        had any serious back pain for the last 7 years.
                    </li>
                    <li>
                        The most recent numbers that I used in the calculator (11/24/2018) were
                        375lb front squat, 315lb push press, 660lb deadlift.
                    </li>
                    <li>
                        I will openly admit that I'm horrible at dieting. I know a good amount
                        about it, but I'm personally bad at executing on it.
                    </li>
                </ul>
                <hr/>
                <h1>Lifting Routine Generator</h1>
                <p>
                    The routines this site generate are extremely simple. They're meant to be
                    as efficient as possible. I can't promise that they'll work for anyone else,
                    but I've been using some version of this generator for years to great effect.
                    Some general tips for usage:
                </p>
                <ul>
                    <li>
                        This routine falls into the 'advanced' category and may not be enough stimulus 
                        for new lifters. My assumption with such short workouts is that your able to 
                        push your body hard enough, consistently enough, that you can't take much more
                        than what's prescribed. It's also 'advanced' in that it's designed specifically
                        for one lifter: Me. Beginner routines tend to be higher volume and less specific.
                        The more advanced the routine, the more targeted the lifts will be. This is why,
                        for example, there is just one accessory movement per day, if that. I know what 
                        I'm weak at and I target it directly.
                    </li>
                    <li>
                        I highly recommend cycling between high and low volume. If you play with the
                        generator a bit, you'll notice that there is overlap in the weights. Week 2 of
                        the heavy routine is 4x4 at 75% of your max and Week 4 of light routine is 5x6
                        at 75%. That's 14 more reps total, using the same weight. This is purposeful.
                        First, I want to build in genuinely difficult peroids, but I can't reasonably
                        sustain that level of effort every week without risking injury. This routine
                        has 'rest' weeks built in. Secondly, the heavy routine is just slightly easier
                        because heavy weights are more dangerous. I want to go into my heaviest weeks
                        more rested.
                    </li>
                    <li>
                        This deals less with my actual routine generator, but I'd like to point out that
                        I don't do traditional bench, squat and deadlift. I do push press, front squat, and
                        hex bar deadlift. I've found that focusing on push press doesn't hurt my bench and
                        it's a much more full body, athletic motion. The spinal compression of back squats
                        kills me, but front squats have never come close to hurting. The hex bar dead is also
                        way better for back backs. I haven't found any upper limits on what my back can handle
                        with front sqauts and hex bar deads. I also always wear a weight belt.
                    </li>
                </ul>
                <hr/>
                <h1>Metabolic Calculator</h1>
                <p>
                    These are less prescriptive than the routine generator. The only really important number
                    there is your TDEE. Everything else is mostly there for fun. Note that I round all of the
                    numbers up, so some things might come out a tiny bit higher than 100%.
                </p>
                <ul>
                    <li>
                       Don't stress about the Body Fat Percentage input. It's not factored into your TDEE anyway.
                       Most people don't know where they fall anyway. The easiest way to get a quick guess is 
                       to google image search "body fat". There's plenty of charts with pictures to help you guess.
                       People severely underestimate their bodyfat. Bias on the high side.
                    </li>
                    <li>
                        Here's the diet advice that's generally going to work for anyone: Eat your TDEE's worth 
                        of calories per day to maintain your weight, 500 calories below your TDEE to lose weight,
                        and 500 above to gain. Eat 0.7g-1.0g of protein per pound of bodyweight, per day. Don't
                        totally cut out fat. Fat has important functions in your body. You can cut carbs really
                        low if you want, but you don't have to. If you want bonus points bias toward foods that 
                        are actually healthy, rather than food that just meets the calorie and protein goals.
                        "Actually Healthy" is a loaded term, but you know what's reasonable. Fruits, veggies, meat,
                        rice, and nuts are good. Anything with added sugar is the devil. Dairy is a weird middle
                        ground but toasted coconut vanilla greek yogurt is going to be your new best friend.
                    </li>
                    <li>
                        For your activity level:
                        <ul>
                            <li>None: No exercise</li>
                            <li>Light: Office job. Exercise 1-3 times per week.</li>
                            <li>Moderate: Office job. Exercise 3-5 times per week.</li>
                            <li>Very: Active job.</li>
                        </ul>
                        I have an office job a do the workouts from the generator 4-5 times per week. I typically
                        enter Light or Moderate.
                    </li>
                    <li>
                        What the values mean:
                        <ul>
                            <li>TDEE: Total Daily Enery Expenditure</li>
                            <li>BMR: Basal Metabolic Rate. This is TDEE with no activity.</li>
                            <li>
                                FFMI: Fat Free Mass Index. This is like BMI, but for muscle mass. Average males are 19.
                                Some studies say that scores above 25 can only be acheived with steroid use. This is
                                debated - and I think it's totally wrong. I'm not giving anyone sideways glances until
                                they're closer to 28. 
                            </li>
                            <li>Body Fat: How many pounds of body fat you have.</li>
                            <li>Lean Mass: How much of your body weight isn't fat.</li>
                            <li>
                                BMI: Weight divided by square of height. It's an old way to measure how fat people
                                are. While it may not be a good measure for you individually, it's actually effective
                                at measuring and predicting health outcomes across a population. If you lift weights
                                this probably doesn't apply to you. I've just included it because it's what your doctor
                                will want to talk about when talking about your weight.
                            </li>
                        </ul>
                    </li>
                </ul>
            </div>
        )
    }
}