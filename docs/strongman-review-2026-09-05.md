# Strongman implementation review — September 5, 2026

Three sub-agents independently reviewed persistence, the planning algorithm, and the
event-day UI. The main agent reviewed tracker integration and verified additional
reproductions. Reviewers were assigned work primarily authored by someone else.
The initial review changed no application code and removed its temporary reproduction
tests. The user subsequently authorized implementation of the recommendations; the
resolution section below records the fixes and retained regression coverage.

The review confirmed **13 bugs: four P1 findings and nine P2 findings**, plus a
normal-day capability-evidence gap. These were gaps in the original passing suite.
The numbered findings describe the pre-fix behavior; line numbers refer to that review.

1. **P1 — A stale event-plan rename can erase a recorded session.**
   [TrackerApp.js:857](../static/src/TrackerApp.js#L857),
   [TrackerApp.js:801](../static/src/TrackerApp.js#L801).

   Open Plans in two tabs. Start and record event work in one; rename the same event
   plan in the stale tab. The rename writes the whole cached routine through the
   unconditional save path. A React DOM reproduction replaced the new session and
   its recorded 300 lb attempt with `session: null`, leaving the profile pointing at
   the event plan. Route renames through a conditional transaction or a transaction
   that changes only the name on the current record. Test that attempts survive a
   concurrent rename and that a rejected save does not publish success.

2. **P1 — Viewing a normal plan can clear another tab's active-event pointer.**
   [TrackerApp.js:844](../static/src/TrackerApp.js#L844).

   After one tab starts an event workout, click View on a normal plan in a previously
   opened tab. `selectRoutine` writes the stale entire profile. The reproduction
   changed `activeWorkoutRoutineId` back to null while the event session remained
   in progress. This bypasses the conditional start protection and can strand the
   session or permit another claim. Update selection without replacing unrelated
   ownership fields. Cover viewing, creating, and copying plans during an external
   active-session change.

3. **P1 — Conflict copies can modify the original plan's host history.**
   [importBackup.js:56](../static/src/data/importBackup.js#L56),
   [strongmanTransfer.js:38](../static/src/data/strongmanTransfer.js#L38).

   Import a changed event plan alongside an unchanged strength routine with its
   completed host slot. The event becomes a conflict copy while the identical host
   is skipped. The copy retains a `hostRef` to that local slot, whose reciprocal
   `eventRef` still identifies the original event plan. Reopening the copy's history
   clears the original host's completion. Detach copied history or create a matching
   copied host; validate reciprocal ownership in the final merged import graph.
   Test import, reopen, and finish against an unchanged local host.

4. **P1 — In-progress conflict copies create sessions that cannot finish.**
   [importBackup.js:32](../static/src/data/importBackup.js#L32),
   [strongmanTransfer.js:41](../static/src/data/strongmanTransfer.js#L41).

   Import a divergent copy of a locally active event plan. Preserving history also
   preserves `session.status: 'inProgress'`, but profile merging retains the original
   owner's active-workout pointer. Both routines contain active sessions; finishing
   the imported copy throws even after the original finishes. Preserve its attempts
   while explicitly resolving active ownership. Test both imports into an idle
   profile and imports while a local strength or event session is active.

5. **P2 — Taper variation swaps load normal training prescriptions.**
   [StrongmanSession.js:115](../static/src/components/StrongmanSession.js#L115).

   During a taper session, switch to a variation with normal work of 300 lb for
   five sets and accepted taper work of 120 lb for two sets. The UI loads 300/five.
   The swap uses `practice.recipe` without checking the phase. Reuse the phase-aware
   selector for all session additions and substitutions. Test taper and recovery,
   including a variation with no accepted taper prescription.

6. **P2 — Saving taper work overwrites the normal prescription.**
   [StrongmanWorkspace.js:113](../static/src/components/StrongmanWorkspace.js#L113).

   Change accepted taper work from 100 to 120 and choose Use this prescription next
   time. The success message appears, but taper remains 100 and normal work changes
   from 250 to 120. The callback always calls the ordinary recipe acceptance path.
   Carry explicit normal/taper scope through the save operation. Test that saving
   either scope preserves the other, along with started and completed snapshots.

7. **P2 — Sequential paired-prescription saves revert an earlier component.**
   [StrongmanSession.js:96](../static/src/components/StrongmanSession.js#L96).

   Save a pick change from 240 to 250, then save a carry change from 40 to 50 in the
   same paired session. The second save sends the pick as 240 again because it merges
   with the original session recipe. Keep the historical session prescription frozen,
   but merge future edits against the latest accepted prescription. Cover successive
   component saves and asynchronous success/failure without losing prior changes.

8. **P2 — Feasible maximum-gap requirements are violated.**
   [strongman.js:316](../static/src/data/strongman.js#L316).

   Reproduction: a 12-week block, five known practices occupying one block each;
   event zero is main priority with frequency one and maximum gap two, and four
   maintenance events have frequency two. Event zero appears in weeks
   `1, 2, 5, 6, 9, 10`. Overdue candidates with an already satisfied fixed-window
   count are discarded despite available overall capacity. Honor deadlines alongside
   exposure targets. Test gaps two and three across window boundaries, competing
   priorities, and feasible versus infeasible demand.

9. **P2 — Extra practices on one day count as extra weekly exposures.**
   [strongman.js:267](../static/src/data/strongman.js#L267).

   Completing three sandbag practices on day one contributes three allocator credits,
   although all happened on one event day. In a reproduced plan with one main and
   two maintenance events, later first-window sandbag appearances fell from three
   to one compared with recording one sandbag block that day. The coverage screen
   correctly counts one completed day, so reporting and allocation disagree. Count
   unique event/week exposures consistently, including overlap with normal-day links.

10. **P2 — Editing capability mappings reinterprets historical evidence.**
    [strongman.js:420](../static/src/data/strongman.js#L420).

    Record a successful 100 lb clean linked to Clean, then change that practice's
    capability mapping to Press. When both checkpoints require 100 lb for one rep,
    the matched result changes from Clean to Press without any historical workout
    changing. Capability evidence uses the current practice mapping. Freeze the
    association and relevant conditions with the attempt or session. Test mapping
    edits, removed practices, renamed capabilities, and medley component mappings.

11. **P2 — Removing a prerequisite capability can empty all future sessions.**
    [strongman.js:124](../static/src/data/strongman.js#L124),
    [strongman.js:191](../static/src/data/strongman.js#L191).

    Remove the capability that a carry practice requires. Its dangling
    `prerequisites: ['deleted-pick']` passes validation, but eligibility subsequently
    excludes the practice. All 12 weeks were empty in the reproduction. Validate
    practice prerequisite existence and types, and make the dependent edit explicit.
    Cover removal through the builder, imported references, and dependency cycles.

12. **P2 — Malformed event backups/transfers pass validation and crash on open.**
    [storageBackup.js:120](../static/src/data/storageBackup.js#L120),
    [storageBackup.js:193](../static/src/data/storageBackup.js#L193).

    Set `workouts[0].exercises` to a string in an otherwise valid event record. Both
    backup parsing and routine-transfer normalization accept it; opening the plan
    throws in the allocator. Validate required known nested structures at a shared
    import boundary while preserving unknown user fields. Test malformed workouts,
    attempts, prescriptions, IDs, and references through both import routes.

13. **P2 — Today changes the selected strength routine after reload.**
    [TrackerApp.js:732](../static/src/TrackerApp.js#L732),
    [TrackerApp.js:851](../static/src/TrackerApp.js#L851).

    With B in `scheduledStrengthRoutineId`, view A and return to Today. Today shows
    A, but reloading shows B. Selecting A updates `activeRoutineId` and local state;
    startup prefers the other persisted pointer. Define one consistent distinction
    between viewing a plan and scheduling Today. Test reload, profile switching,
    copying, and importing with different viewed and scheduled routines.

One additional evidence gap was reproduced:
[strongmanIntegration.js:136](../static/src/data/strongmanIntegration.js#L136) supplies
coverage completion metadata without actual set measurements, while
[strongman.js:418](../static/src/data/strongman.js#L418) evaluates checkpoints only
from dedicated event blocks. A linked normal-day axle clean can satisfy coverage
but never appear as matching checkpoint evidence. Decide and document whether
normal-day work should support checkpoint suggestions, and test that behavior;
current tests only establish coverage recognition.

The highest-value simplifications are:

- Use one transactional update boundary for routine/profile actions. Ownership
  checks should not depend on which screen initiated the write.
- Build one immutable exposure/evidence projection for allocation, coverage, and
  checkpoint review, with unique event/week identity and frozen source context.
- Share phase-aware prescription selection and saving across builder, details,
  swaps, extra practices, and paired edits. Separate the frozen session recipe
  from the currently accepted future recipe.
- Validate known imported structures once, then validate the final merged graph
  for reciprocal bindings and active-session ownership.
- Clarify viewed versus scheduled routine state rather than maintaining competing
  fallbacks. Preserve the existing lazy-loading boundaries and bundle budget.

Existing coverage is strong around legacy strength calculations, fresh and upgraded
databases, typed attempts, ordinary session lifecycle, and offline resume. Important
gaps are multi-action sequences, imported active graphs, cross-screen stale writes,
phase-specific edits, rolling scheduling properties, and checkpoint provenance.
The 12-versus-10 browser scenario verifies lengths and the first linked session;
extend it through the actual end of each block, leftover host slots, and standalone
continuation. Property-style tests for capacity, gap deadlines, unique exposures,
and snapshot invariance would complement the existing examples.

The review used 14 focused reproduction cases across the team. After removing the
temporary tests, the main agent reran the existing suite: 343 tests in 37 suites
passed. The prior implementation run also passed 16 browser checks. Reproductions
exposed cases not covered by those passing checks.

## Resolution

All 13 findings and the normal-day evidence gap have been addressed. Regression tests
were added and observed failing before the corresponding fixes. Shared helpers now
cover field-only conditional writes, phase-specific prescriptions, weekly exposure and
checkpoint evidence, nested import validation, and final imported ownership.

| Findings | Result | Regression coverage |
| --- | --- | --- |
| 1, 2, 13 | Rename/selection preserve latest session fields; creation is conditional; Today selection survives reload. | `TrackerApp.planActions.test.js`, `recordActions.test.js` |
| 3, 4 | Validate reciprocal hosts in the final merged graph and again on finish/reopen. Pause extra imported sessions, preserve attempts, and resume explicitly with one profile owner. | `importBackup.test.js`, `strongmanIntegration.test.js`, `StrongmanWorkspace.test.js`, PWA import/resume scenario |
| 5, 6, 7 | Shared normal/taper selection and editors; sequential component saves retain earlier accepted changes and current drafts. | `strongmanPrescription.test.js`, `StrongmanSession.test.js`, builder/details/workspace tests |
| 8, 9 | Unique event-week exposures and maximum-gap deadlines, including competing requirements, fourth-slot capacity, and visible locked-session conflicts. | `strongmanEvidence.test.js`, `strongman.test.js` |
| 10 and evidence gap | Freeze capability associations, preserve unknown legacy associations, and use exact linked normal-day actual sets with compatible conditions. | `strongmanEvidence.test.js`, session/details and migration tests |
| 11 | Reject dangling/cyclic prerequisite references and prevent deleting a checkpoint still used by a practice. | `strongmanEvidence.test.js`, `strongman.test.js`, `StrongmanBuilder.test.js` |
| 12 | Validate known nested records at backup/transfer boundaries; preserve extension fields and unknown user records. | `storage.test.js`, `strongmanTransfer.test.js`, `dataTaskHandlers.test.js` |

Follow-up checks also fixed paused ordinary-workout resume and recalculation, missing
imported attempt-entry drafts, and overbroad rewriting of unknown extension fields when
copying a plan. DB and backup version 11 retain all prior migration steps and add nullable
historical capability snapshots; fresh, version-10, and older upgrades are covered.

Full Jest verification: **413 tests in 42 suites passed**. The production build and
service-worker generation passed with **65.83 kB gzip** initial JavaScript, below the
unchanged **66.70 kB** limit. Plan controls now load with their secondary screens.

The extended PWA checks perform event weeks 11–12 after a fixture establishes completion
of the ten-week strength block, assert strength history remains unchanged, and exercise
a real conflict import followed by blocked resume, original completion, activation,
resume, and completion with attempts intact. These focused browser checks passed.
The full local website/mobile-PWA Playwright suite also passed: **17 tests**, including
ordinary tracking, history, backup imports, offline/update behavior, and both real
WebRTC transfer scopes. Physical Android installation remains unverified. No deployment
was performed.
