# Strongman training log

Dedicated Strongman days use an open training log. Competition targets are
reference information and never generate prescribed weights, sets, or reps.

- Add competition details when building a routine, from the shared card in Plans, or
  from any Strongman day. Leave unannounced details blank. A medley contains
  independently editable implements plus its own full-event results.
- Each profile has one active competition. It carries across new plans, copies,
  and templates until you mark it complete, remove it, or its date has passed.
  Dated competitions complete automatically on the following local calendar day,
  when the app is open or next reopened. Undated competitions stay active.
  Finishing or deleting a plan or disabling Strongman days does not end it.
  Editing targets updates the shared reference across plans.
  Copies into another profile use that person's active competition.
- Each saved medley's Add run action starts a separate result with its own
  actual setup. Its implements can be corrected later without changing other
  results. Multiple runs entered together share the setup shown in that editor.
- Add an exercise on the day, enter one actual set, and add sets as needed.
  Record a pickup with reps, a carry with distance, and a run or hold with time.
  Unsuccessful attempts stay in history without becoming successful records.
- Log past training with its original date to backfill a plan already underway.
  Choose its original competition when needed, including when one plan spans
  multiple meets. A backfill belongs to that plan without fabricating a completed workout.
- Deleting an unfinished Strongman day keeps saved actual results as dated
  history in Progress. Leaving an open editor requires confirming discard;
  save each exercise to retain it.
- Progress includes Strongman records across all plans for the selected profile.
  Reusing the same movement name, ignoring capitalization and extra spaces,
  brings those records forward. Use distinct names for different variations.

“This competition” includes preparation logged across plans for that meet.
Completing or removing a competition retains training results and its saved
details. A new competition starts a separate preparation record while matching
lifetime records remain available. Heaviest
results retain their actual distance/reps/time; weight takes priority, so this
does not imply that a shorter, heavier carry is better at the competition task.
Timed medley records compare saved actual courses, including implement order,
weights, and distances. Editing a competition cannot rewrite earlier results.

## Record goals and setup

Choose the record goal before filling in the competition details:

| Goal | Score | Setup |
| --- | --- | --- |
| Faster is better | Lowest elapsed seconds | Load, distance, repetitions, fixed height, and rules |
| Longer hold is better | Highest hold duration | Load and task |
| More reps is better | Highest repetitions | Load, distance, fixed height, and actual time window |
| Heavier is better | Highest successful load | Exact rep requirement when specified, distance, fixed height, and rules |
| Farther is better | Greatest horizontal feet | Load, repetitions, fixed height, and optional actual time window |
| Higher is better | Greatest vertical inches | Implement load, repetitions, distance, and optional actual time window |
| More points is better | Highest manually entered score | Saved scoring rules, fixed event conditions, and actual time window |

The measure being scored is an optional target, not a comparison condition.
For a max lift, weight can stay blank. Blank rep requirements allow weight-only
attempts; a specified rep count compares that exact count. A blank time window
means untimed work. An elapsed run time is not silently treated as a window for
a distance or height record. Existing rep comparison behavior remains available.

Height is distinct from horizontal distance. Use the optional height field for
a fixed loading platform or throwing bar even when the event is scored by reps
or time. Enter the actual height when logging the work.

Use setup/scoring rules to distinguish routes, allowed drops, equipment, and
single-attempt versus aggregate scores. Matching ignores capitalization and
extra spaces, but changed rules produce separate records. Points need explicit
rules before a result is saved; no weighted-rep formula is guessed. A timed
medley retains its ordered implements. Other circuits can use a scored event
and separate logs for component practice. Promoter tie-breakers and partial
event scores are not automatically converted into an official placing.

The [Iron Podium research sample](strongman-event-research.md) documents 67
contest events and the design decisions behind these choices.

Database and backup version 17 added `inputs.strongmanCompetition` and
`routine.strongmanLog`. The migration supplies empty containers without turning
old prescriptions into results or altering completed sessions. Old retired
strongman planner archives remain preserved. Backups and device transfers carry
the new records; a fresh routine copy starts with an empty log. Deleting an
entire plan deletes its training history, including its Strongman records.
Version 18 added the rep goal. Version 19 adds max-weight, distance, height,
and points goals with optional height, points, and scoring-rule fields. Its
migrations preserve existing records exactly; no historical results are inferred.

Version 20 adds profile-level active competition and competition history, plus
competition IDs on training entries. It adopts the active plan's existing meet
when available, otherwise the most recently updated unarchived plan's meet.
Only identical legacy configurations within one profile share an identity;
other plan snapshots remain intact. Explicitly ended competitions never revive
from old plans or templates. Profile writes use fresh records and conflict checks
so another window's completion or removal cannot be overwritten by plan selection
or routine workout updates. Backup imports retain distinct competition details
while keeping the destination profile's current active or inactive choice.
