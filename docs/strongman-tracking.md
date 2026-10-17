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
- The training workspace comes first; competition targets are a collapsed
  reference below it. Add an exercise, enter one actual set, and choose **Log
  set** (or **Log run**). The editor closes to a compact saved row. **Add set**
  reuses the latest numbers so only changed measures need entering. Each row
  has its own edit action, with only one set's fields open at a time.
  Exercise details holds the date, movement, record goal, rules, and notes;
  medley setup and optional set details expand when needed.
  Backfilled results offer the same add-next-set flow, including from Progress.
- Adding a set or run keeps earlier results unchanged. Matching setup, date,
  and notes append to the same entry; changing them creates a separate result.
  Editing an existing entry's shared setup deliberately affects all its sets.
  Editing an individual row changes only that set or run; a different setup
  splits it into its own result while retaining the other efforts unchanged.
- **Copy previous workout** lists earlier actual training dates, weeks ago,
  and a brief exercise preview across this profile's plans. It loads weights,
  reps, distance, times, height, points, and actual setup as pending sets.
  Past performance notes and unsuccessful outcomes are not carried forward.
  Each copied set is editable before logging; copying alone creates no results
  or records. Logged and remaining counts show progress. Pending work survives
  leaving the screen, reloads, and backup/restore. Skip a set or clear remaining
  sets when the plan changes; neither action removes logged results.
- Log each effort before adding another.
  Record a pickup with reps, a carry with distance, and a run or hold with time.
  Unsuccessful attempts stay in history without becoming successful records.
- Log past training with its original date to backfill a plan already underway.
  Choose its original competition when needed, including when one plan spans
  multiple meets. A backfill belongs to that plan without fabricating a completed workout.
- Deleting an unfinished Strongman day keeps saved actual results as dated
  history in Progress. Leaving an open editor requires confirming discard;
  log each set to retain it. Finish the day after logging, skipping, or clearing
  copied sets. Finishing is the only action that completes the workout.
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

Database and backup version 23 adds optional `workout.strongmanQueue` for
pending copied sets. Old records remain untouched; migrations only advance the
format marker. Logging a copied set saves its result and removes its prefill in
one transaction. Plan edits retain pending workouts, and routine copies start
without copied sets or results.

Version 20 adds profile-level active competition and competition history, plus
competition IDs on training entries. It adopts the active plan's existing meet
when available, otherwise the most recently updated unarchived plan's meet.
Only identical legacy configurations within one profile share an identity;
other plan snapshots remain intact. Explicitly ended competitions never revive
from old plans or templates. Profile writes use fresh records and conflict checks
so another window's completion or removal cannot be overwritten by plan selection
or routine workout updates. Backup imports retain distinct competition details
while keeping the destination profile's current active or inactive choice.
