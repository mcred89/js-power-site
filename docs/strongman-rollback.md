# Strongman planner rollback

The independent strongman planner and its Today creation controls from
`02be339` and `087740c` are reverted. The existing strength generator, optional
strongman work on normal days, and manually programmed strongman day remain.

Database and backup versions move forward to 12. Versions 10 and 11 shipped to
users and their migration steps must remain; lowering the IndexedDB version
would prevent those installations from opening.

Migration 12 removes standalone strongman routines and templates from active
stores, preserving their complete records in the `archives` store. It restores
strength plan references and untouched empty strongman-day placeholders, and
removes the retired profile scheduling fields. Completed and started workout
snapshots stay intact, including paused strength sessions.

JSON backups and full device transfers include archives. Import previews show
archived records, and conflicts preserve both copies. Archives are never loaded
into the routine planner or workout queue. Deleting a profile also removes its
archived routines in the same transaction. Strongman routine templates, like
other templates, are global records.

The migration is automatic and transactional. Backups from older releases are
normalized through the same cleanup; an older backup cannot reactivate the
retired planner. Normal strength routine transfers from both deployed transfer
formats remain supported.
