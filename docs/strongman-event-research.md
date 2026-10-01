# Strongman scoring sample

Reviewed on September 30, 2026: **67 advertised contest events across 14 Iron Podium competition listings**. Each numbered contest slot counts once, not once per weight class. This is a deliberately varied sample, not a prevalence estimate. Duplicate tables, unannounced bonus events, and optional tie-breakers are excluded. Event descriptions below are paraphrased; listings can change.

| Slots | Competition | Events reviewed and scoring |
| --- | --- | --- |
| 1–5 | [APEX Strength Games III, September 2026](https://ironpodium.com/browse/ev/apex-strength-games-ii) | Repeated deadlifts; two-load overhead scoring; ordered bag loading; wheelbarrow race; loaded grip hold. Goals: reps, weighted points, time, time, duration. |
| 6–9 | [Brawl in the Fall, September 2026](https://ironpodium.com/browse/ev/brawl-in-the-fall-2026-1) | Repeated single-arm overhead lifts; trap-bar maximum; carry-and-press sequence; repeated three-movement circuit. Goals: reps, weight, time, reps. |
| 10–14 | [Southeast Regionals, April 2026](https://ironpodium.com/browse/ev/strongman-corporation-southeast-regionals-hosted-at-scott-helm-s-memorial-strongman) | Overhead maximum; repeated pulls; two-implement carry; three-object carry; repeated keg loading. Goals: weight, reps, time/partial distance, time/partial distance, reps. |
| 15–19 | [Northside Classic, June 2026](https://ironpodium.com/browse/ev/2026-northside-classic) | Heavy-or-light overhead repetitions; ascending pulls; finger flips; three-object carry; ascending stone loading. Goals: load-prioritized reps, time, reps, time, time with splits. |
| 20–24 | [Moving Classic, April 2024](https://ironpodium.com/browse/event/the-strongman-moving-classic) | Overhead maximum; rotating loaded carry; maximum-load 30-foot carry; repeated axle pulls; bag endurance carry. Goals: weight, distance, weight with required distance, reps, distance. |
| 25–29 | [OSG Southwest Regionals, August 2025](https://ironpodium.com/browse/ev/official-strongman-games-southwest-regionals) | Escalating overhead repetitions; carry/load sequence; progressively raised athlete position for pulling; five-bag throwing sequence; capped backward drag. Goals: reps, time/partial work, reps, time with splits, distance. |
| 30–34 | [New Hampshire championship, October 2024](https://ironpodium.com/browse/event/nh-strongman-championship) | Alternating overhead lifts; three throws summed; rising pulls; repeated bag shouldering; opposed harness pull. Goals: reps, aggregate distance, weight, reps, distance. |
| 35–39 | [Mississippi championship, December 2024](https://ironpodium.com/browse/event/mississippi-s-strongest-man-and-woman) | Axle overhead maximum; elevated-handle pulls; endurance bag carry; rising-bar throw; repeated keg loads. Goals: weight, reps, distance, height, reps. |
| 40–44 | [Natural USA West Coast, May 2025](https://ironpodium.com/browse/event/natural-strongman-usa-west-coast-championship) | Finger flips; progressively loaded carry; horizontal bag throw; raised axle pulls; grip endurance. Goals: reps, distance with time tie-break, distance, reps, duration. |
| 45–49 | [Yard Brawl, May 2026](https://ironpodium.com/browse/event/the-yard-s-summer-strength-showdown) | Raised pull maximum; four-object overhead sequence; farmer shuttle; rotating carry; five-bag throwing sequence. Goals: weight, time, time, distance, time. |
| 50–54 | [Apex Classic day two, March 2025](https://ironpodium.com/browse/event/the-apex-strongman-classic) | Axle overhead maximum; rotating carry; four-style pulling sequence; harnessed vehicle pull; unequal-hand endurance carry. Goals: weight, distance, time, time, distance. |
| 55–58 | [Kansas City Ultimate II, November 2025](https://ironpodium.com/browse/event/kansas-city-s-ultimate-strongman-ii) | Trap-bar maximum; carry/load sequence; best of three throws; ascending overhead series with a repetition finish. Goals: weight, time/partial distance, distance, reps. |
| 59–62 | [Revolution of the Strong(wo)men, June 2024](https://ironpodium.com/browse/event/revolution-of-the-strong-wo-men-1) | Stone maximum; weighted overhead repetitions; carry/load circuit with bonuses; repeated vehicle-frame pulls. Goals: weight, points, points, reps. |
| 63–67 | [Rhode Island III, December 2024](https://ironpodium.com/browse/event/uss-rhode-islands-strongest-man-and-woman-iii) | Two-load overhead scoring; five-stage pulls; throwing zones (listed hold replacement); yoke shuttle; opposed stone loading. Goals: weighted points, reps/splits, points or hold duration, time, reps. The replacement is counted as one advertised slot. |

## Product decisions

Seven record goals cover the observed basic score dimensions: fastest time, longest hold, most reps, heaviest weight, farthest distance, highest height, and most points. Event names alone do not identify comparable setups.

- Max weight has no required target load. A rep or carry requirement may still apply.
- Maximum distance uses horizontal feet, a fixed load, and an optional recorded time window. Carry route, turns, drops, increasing loads, and aggregate-versus-single attempts belong in setup rules.
- Maximum height uses a separate inches field. A fixed loading or throwing bar height remains setup context for other goals; it is not their score.
- Points are manually entered totals with explicit scoring rules. The app does not infer weighted repetitions or bonuses. Different rules remain separate comparisons.
- A full timed medley keeps its ordered actual implements. A points-based circuit can be represented as a scored event with its rules; its component practice can be logged separately. Partial work, opponent-dependent results, and promoter tie-breakers are not automatically converted into official rankings.
- Missing targets remain unknown. Saved actuals and their rule/setup snapshots must not change when future competition details change.

The contrast between New Hampshire's total of three throws and Kansas City's best throw shows why a universal “distance record” without setup rules would be misleading. The fixed-height timed bag series in Yard Brawl and the rising-height Mississippi throw similarly require separate height and time semantics. These are design inferences from the linked listings.

## Main-lift variants: discussion only

This idea is deferred at the user's request. The planning, possible user flows,
implementation considerations, and open decisions now live in
[Main-lift variations and competition tracking](../potential_features/main-lift-variations.md).
No main-program variant implementation is included in the Strongman scoring release.
