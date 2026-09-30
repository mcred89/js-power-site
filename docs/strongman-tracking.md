# Strongman training log

Dedicated Strongman days use an open training log. Competition targets are
reference information and never generate prescribed weights, sets, or reps.

- Add competition details when building a routine, from its card in Plans, or
  from any Strongman day. Leave unannounced details blank. A medley contains
  independently editable implements plus its own full-event results.
- Each saved medley's Add run action starts a separate result with its own
  actual setup. Its implements can be corrected later without changing other
  results. Multiple runs entered together share the setup shown in that editor.
- Add an exercise on the day, enter one actual set, and add sets as needed.
  Record a pickup with reps, a carry with distance, and a run or hold with time.
  Unsuccessful attempts stay in history without becoming successful records.
- Log past training with its original date to backfill a plan already underway.
  A backfill belongs to that plan without fabricating a completed workout.
- Deleting an unfinished Strongman day keeps saved actual results as dated
  history in Progress. Leaving an open editor requires confirming discard;
  save each exercise to retain it.
- Progress includes Strongman records across all plans for the selected profile.
  Reusing the same movement name, ignoring capitalization and extra spaces,
  brings those records forward. Use distinct names for different variations.

“This plan” means the entire routine, including its microcycles. Heaviest
results retain their actual distance/reps/time; weight takes priority, so this
does not imply that a shorter, heavier carry is better at the competition task.
Timed medley records compare saved actual courses, including implement order,
weights, and distances. Editing a competition cannot rewrite earlier results.

Database and backup version 17 add `inputs.strongmanCompetition` and
`routine.strongmanLog`. The migration supplies empty containers without turning
old prescriptions into results or altering completed sessions. Old retired
strongman planner archives remain preserved. Backups and device transfers carry
the new records; a fresh routine copy starts with an empty log. Deleting an
entire plan deletes its training history, including its Strongman records.
