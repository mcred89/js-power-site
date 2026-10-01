# Main-lift variations and competition tracking

**Status:** Deferred; not implemented.

**Last discussed:** September 30, 2026.

**Latest user decision:** Leave this feature off for now and save the planning
for possible future work. Recording this proposal does not reopen implementation.

## Problem and examples

The main program identifies its primary lifts as Squat, Press, and Deadlift.
The movement performed may vary with the upcoming competition, while the log
still records the generic name.

- In the current cycle, the user performs deficit deadlifts during ordinary
  deadlift workouts to prepare for a deficit-deadlift-for-reps event. The deficit
  height has not been specified.
- In the previous cycle, the user performed raised trap-bar deadlifts for that
  competition. The handle height has not been specified. Those results should
  remain distinguishable from deficit pulls.
- The same need could apply to overhead press versus bench press and back squat
  versus front squat.

The user wants normal training to contribute relevant competition-training
history without logging the same work twice. They have not decided whether the
added setup and tracking complexity is worthwhile.

## Proposed experience

The proposed model separates a **program slot** from the **movement performed**.
The slot keeps the workout schedule and progression strategy; the movement
identifies the applicable training max, actual sets, and records.

| Program slot | Example movement this cycle |
| --- | --- |
| Deadlift | Deficit barbell deadlift, with the actual deficit height specified |
| Press | Strict overhead press |
| Squat | Back squat |

Recommended directions below are unapproved proposals:

1. **Set a cycle default.** During plan creation or Update plan, choose the
   movement for each main lift from recent variations, common choices, or a
   custom entry. Include meaningful setup details such as deficit or handle height.
2. **Give each variation its own training max.** Reuse a remembered max or enter
   a new one. A bench max should not automatically prescribe overhead-press
   weights, and a raised trap-bar estimate should not increase the deficit max.
   The existing percentage and progression strategies could still be used.
3. **Allow a today-only override.** Show a clear label such as “Deadlift day ·
   Deficit deadlift.” Changing the movement during a session would preserve
   already recorded sets and apply the new identity only to later sets.
4. **Optionally connect a competition event.** “Counts toward: Deficit deadlift
   for reps” would surface the normal workout's completed sets in that event's
   training history. An explicit connection is preferable to guessing from names.
5. **Keep records specific.** Default Progress to the selected variation, with
   an optional family view for training frequency or volume. Keep deficit,
   conventional, and raised trap-bar records distinct across competitions.
6. **Identify old training deliberately.** A future history-editing flow could
   label selected old workouts as raised trap bar. Generic historical Deadlift
   records would remain unspecified unless the user explicitly changes them.

The tradeoff is an extra movement choice and training-max decision when changing
variations. Routine daily logging should stay as simple as it is today.

## Open decisions

- Is a cycle default with occasional daily overrides sufficient, or does the
  user switch variations within the same workout often enough to need prominent
  set-level controls?
- Does the default apply to the whole plan or to each microcycle within it?
- Should variations initially label records only, or also own their training
  maxes and adaptive progression? Separate maxes are recommended, but not approved.
- Which setup details need structured fields, and which can remain descriptive
  text? Decide how intentionally equivalent variations reuse the same identity.
- Should back-off work inherit the chosen main variation by default? How should
  an explicit back-off substitution be presented and preserved?
- Should a competition link apply across the cycle or be optional per workout?
  How should the app show linked training that does not match the full event setup?
- How should a new variation's starting max be chosen, and what happens to fixed
  progression baselines when switching midway through a cycle?
- How much historical relabeling is useful, and what preview/undo experience
  would make that deliberate and understandable?

## Implementation considerations

These are investigation notes as of the discussion date, not a finalized schema:

- Persist stable program-slot and variation identities independently of display
  names. Capture the actual variation/setup on individual recorded sets so later
  plan edits or session substitutions cannot relabel earlier work.
- Scope training maxes, estimated maxima, and adaptive evidence to matching
  variations. Switching to a weaker variation must allow a lower starting max.
- Recalculate only eligible future, unstarted work. Preserve completed snapshots,
  started or paused sessions, explicit exercise overrides, and back-off roles.
- Derive linked Strongman results from stable source-set identifiers rather than
  copying sets into a second editable log. Define how edits, undo, deletion,
  archive, routine copying, and imports affect the linked view.
- Four sets of five remain four sets, not one 20-rep event result. An untimed set
  cannot become a 60-second event record merely because that is the competition
  limit. An optional actual event window could be recorded for deliberate event
  practice. Session elapsed time and set split timestamps are not event duration.
  Compare matching loads, setup, and rules before showing an event PR.
- Preserve profile boundaries and offline operation. Keep the app client-only;
  no account, synchronization service, or application server is proposed.
- Any stored-shape change would require the next available ordered IndexedDB and
  backup migrations, including copies, templates, exports, transfers, and import
  compatibility. Do not reserve a version number now or infer old variations.

Current code areas to revisit:

| Area | Why it matters |
| --- | --- |
| [routineGeneration.js](../static/src/data/routineGeneration.js) and [routines.js](../static/src/data/routines.js) | Program slots, maxes, generated names, prior-load lookup, and session snapshots currently share the generic lift identity. |
| [estimatedMax.js](../static/src/data/estimatedMax.js) | Main-lift recognition currently matches the generic display names; a rename alone can remove a lift from adaptive estimates. |
| [progress.js](../static/src/data/progress.js) | Strength reporting also relies on generic main-lift recognition. |
| [routineRecalculation.js](../static/src/data/routineRecalculation.js) | Generated exercise roles and override preservation must survive variation changes. |
| [workoutActions.js](../static/src/data/workoutActions.js) | Session substitutions need to preserve the identity of previously settled sets. |
| [strongman.js](../static/src/data/strongman.js) | Strongman records currently read the dedicated log; regular workout sets are not connected. |
| [storageMigrations.js](../static/src/data/storageMigrations.js) and [storageBackup.js](../static/src/data/storageBackup.js) | Future persistence changes need versioned, non-destructive compatibility handling. |

## Validation scenarios if resumed

- A deficit-deadlift cycle logs normal prescribed work once and shows the same
  actual sets in the explicitly linked event's training history.
- Switching from raised trap bar to deficit work uses the chosen deficit max;
  each variation retains its own past records and progression evidence.
- Changing only today's movement leaves other scheduled workouts unchanged.
  Changing after a settled set preserves that set's original variation.
- A future plan update preserves completed work, paused sessions, and explicit
  substitutions; correcting old history changes only the records selected.
- Untimed work and separate sets cannot claim a combined or timed-event score.
  Different deficit heights, handle heights, or competition rules stay distinct.
- Bench/overhead and front/back squat choices follow the same behavior as deadlift.
- Backup restore, device transfer, profile switching, duplicate imports, copies,
  and source-set edits/deletion preserve identity and do not double-count results.

## Related work

The [Strongman tracking feature](../docs/strongman-tracking.md) and
[event-scoring research](../docs/strongman-event-research.md) are already separate
completed work. Their seven record goals remain available. This deferred idea
concerns integration with the main program and does not disable those features.
