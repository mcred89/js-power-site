# Strongman planning

## Accepted design

The strength routine supplies dedicated Strongman day slots. An independent strongman
block supplies the work, owns its results, and continues across strength routines.
Existing events on squat, press, and deadlift days remain user-controlled: automatic
event planning must never remove or rewrite their movements, sets, reps, or overrides.

An active event block forces the dedicated-day option on for newly generated strength
routines. Preserve the compressed three-week schedule, including its existing deadlift
replacement. Saved, paused, or completed blocks do not force the option. Previewing
does not reserve an event workout. Starting binds a host slot to the event-owned session
atomically. Standalone event sessions use the same sequence. One session per profile.

## Programming

- Event weeks advance through completed or explicitly skipped event sessions, not dates.
- Competition dates remain fixed; falling behind prompts review, never automatic catch-up.
- Twelve-week preset: 4 base / 4 development / 3 specific / 1 taper. Ten-week: 3/3/3/1.
- Phases are editable. General training uses renewable four-week base blocks.
- Unknown movements receive baseline assessments in the earliest base rotation, occupying
  normal session capacity. Missing equipment keeps the exact event unassessed.
- Generate up to four event blocks, planning coverage over the next four event days.
- Default four-day exposure targets: main focus 3, maintenance 2, occasional 1. Preserve
  locks, prioritize assessments and due coverage, then weaknesses and useful variety.
- Count unique event weeks, including overlapping normal-day work and multiple components
  on one event day. Honor maximum-gap deadlines across rotation boundaries; show conflicts
  when locked work, unavailable practices, or capacity prevents them from fitting.
- Keep stable priority practice and deterministic A/B clean-and-press/load/carry variety.
  Show coverage conflicts; never silently add a fifth block or indefinitely defer an event.
- Medleys have separate component, transition, and full-event coverage. Large accepted
  prescriptions can occupy multiple blocks; a card is not unlimited session capacity.
- Model condition-specific capabilities. Picking a bag does not establish carrying it;
  lighter full carries remain eligible while a target-load pick is being developed.
- Repeat accepted comparable prescriptions. Unknown work is set up on assessment day.
  Actual results do not replace accepted prescriptions without an explicit action.
- Adapt only unstarted, unlocked event-day drafts. Confirm capability advances and harder
  prescriptions. Failed/skipped work never automatically certifies or demotes capability.
- Normal-day coverage is explicit, component-specific, and distinguishes support from
  matching event practice. Count performed work once and flag broken coverage links.
- Freeze checkpoint associations with each session and coverage link. Matching completed
  normal-day actual sets can suggest checkpoints under explicitly linked conditions;
  planned work, support links, and legacy records with unknown associations cannot.
- Keep normal and taper/recovery prescriptions separate, including each medley leg.
  Successive accepted component edits merge with the latest accepted future prescription
  while the session's original prescription and attempts remain historical snapshots.

## Interfaces and lifecycle

Use the existing IndexedDB routines store with strength/strongman kinds. Event plans own
phases, event/practice/capability IDs, accepted recipes, stable week IDs, and workouts.
Host slots own only references and resolution metadata. Freeze started/historical work
and preserve explicit future overrides by stable IDs. Use typed load/reps/distance/time/
success fields, explicit setup and units, separate from workout elapsed time and e1RM.

Skipping an unbound host does not consume an event week. Skipping an event week retains
a skipped record. Ending a strength routine leaves remaining events available standalone;
new hosts continue them. Ending the event block leaves later hosts manual or ready for
a new block. Reopening history keeps its original pairing and does not rewind progression.
Deleting a host preserves event history; an active pairing must be resolved before deletion.
Legacy edited/completed Strongman days remain intact; only untouched future placeholders
may be explicitly converted. Resume is independent of the selected plan's pending queue.

Migrate DB and backup 9 to 10 to 11, retaining all older steps and unknown user fields. Include
both plan kinds in backups, exports, templates, imports, and transfers. Conflict-copy
divergent event records rather than shallow-merging incompatible graphs. Remap internal
copy references; clear fresh-copy evidence/bindings and expose missing external links.
Routine transfer v2 retains v1 reader compatibility; encryption remains unchanged.
Version 11 marks missing historical capability associations unknown instead of inferring
them from current practice definitions. Validate known nested imported structures before
saving and reciprocal host/event ownership after merging with local records. Preserve the
local active session; pause additional imported sessions with their attempts and elapsed
time intact. Resume explicitly after the current workout finishes. Paused ordinary-workout
sets and prescriptions also survive resume, max correction, and adaptive recalculation.

## Test-driven implementation

1. Characterize all existing strength/normal-day event combinations and exports first.
2. Write failing planner tests, implement pure allocation/baseline/capability behavior.
3. Write failing migration/import/ownership tests, then implement persistence.
4. Write failing host/session/queue tests, then connect the tracker.
5. Write failing builder/session tests, then deliver accessible phone-first screens.
6. Extend website/PWA smoke coverage and run the full Jest suite, build, bundle budget,
   and both local Playwright projects. Verify offline/update behavior and report any
   physical Android verification that cannot be performed.

Baseline: 225 tests in 25 suites passed on bundled Node 24.19.0. System Node 8 is too old.
The application remains local, offline-capable static content. No deployment or AWS
infrastructure change is included.

## Implemented workflow

In the installed app, an empty profile offers both strength and strongman creation cards
on Today. Once any routine is saved, use **Today → Add plan → Strongman block**
or **Plans → New strongman block**. Saved and paused routines count as existing setup.
Today keeps the compact Add plan action available while showing current workouts;
an active strongman block also shows its event-day actions.
Enter the independent
block length, competition date if known, phases, events, priorities, equipment,
and variations. In the website calculator, choose **Strongman block** to preview
the same setup without saving anything; choosing a local profile enables an
explicit save as an inactive block.

For a 12-week event block alongside two 5-week strength cycles, enter 12 weeks in
the strongman builder and keep the two strength cycles in the normal routine
builder. Each generated Strongman slot opens the next event session. After the
10-week strength routine ends, the two remaining event weeks can be performed
standalone or through slots in the next strength routine.

For a target sandbag carry that cannot yet be picked, create distinct practices
for picking the target bag and carrying a manageable bag. Add a checkpoint for
acquiring the target bag under its actual conditions; require that checkpoint for
the target-load carry. Keep the lighter carry available independently. The same
checkpoint/prerequisite model supports clean versus press, implement acquisition
versus travel, loading height, traction, and medley legs versus full rehearsals.
Confirm checkpoints after reviewing the evidence; successful results alone do not
silently change a prescription or certify another component.

For base building, enter clean-and-press, load, and carry practices and their A/B
variations. Set phase preferences to move toward competition implements later.
Unknown available practices receive early assessment slots; unavailable equipment
and excessive coverage demands remain visible for review. Set maintenance or
occasional frequency for events that need less dedicated practice.

On event day, review the reason for each practice, enter its actual setup and
load/reps/distance/time, and record successful, partial, or unsuccessful attempts.
Zero is a valid result; unknown measurements remain blank. Paired work and medleys
record their parts explicitly. Session edits save locally, and an unfinished
session can be resumed offline. Accepting a future prescription changes only
unstarted, unlocked event drafts.

Normal-day event exercises remain independently editable. Optional coverage links
identify a specific exercise occurrence, its visible prescription, the component
it covers, and the event week it contributes to. Changed or missing sources require
review. Previews refresh this evidence without writing; starting a session freezes
the refreshed draft. Conditional transactions protect starts, event edits, skips,
activation, and linked deletion against stale tabs.
Renames and routine selection patch only their requested fields on the latest stored
record. Selecting a normal routine keeps it on Today after reload. Neither action can
clear another tab's active-session ownership or overwrite recorded attempts.

The implementation includes database/backup version 11 migrations, compatible
backup and routine transfers, typed event CSV exports, fresh copies/templates,
completed history, and single-session ownership. Rarely used screens, generation,
plan controls, and transfer operations load separately while remaining in the offline precache.

## Verification — September 5, 2026

The core strongman implementation was deployed in commit `02be339`. These results
include the subsequent Today creation refinement, which has been verified locally.

- Tests were written and observed failing before implementing planner, lifecycle,
  migration, coverage, session, and UI behavior. Existing strength calculations and
  normal-day strongman prescriptions were characterized first.
- Full Jest suite after review and Today entry fixes: **427 tests in 42 suites passed**.
- Production build and service-worker generation passed. Initial JavaScript is
  **66.11 kB gzip**, within the unchanged **66.70 kB** budget; 35 assets are precached.
- Targeted browser checks passed for offline event resume, standalone weeks 11–12
  after a ten-week strength block, preserved normal-day exercises, and explicit resume
  of an imported conflict copy after its original active session finishes.
- Full local Playwright suite: **18 tests passed** across the website and mobile PWA,
  including normal workouts, history, future max correction, backup imports, offline
  install/update caching, both real WebRTC transfer scopes, empty-profile creation,
  and adding strongman from Today's compact action during an existing strength block.
- Reviewed mobile builder, block, and session screenshots; checked viewport overflow.
  Physical Android Chrome installation remains unverified. The Today entry refinement
  has not been deployed.
