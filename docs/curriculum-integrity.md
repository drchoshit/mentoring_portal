# Curriculum preservation and recovery

Curricula are carried forward per student and subject from the latest nonempty earlier week. Missing or unvisited intervening weeks no longer break inheritance. A selected source week remains an upper bound. Existing nonempty curricula and archived subjects are never overwritten by inheritance. New week creation also materializes curricula for printing/sharing before anyone opens the record page.

Updates to `a_curriculum` require `expected_curriculum`, containing the original value seen by the editor (null and an empty string are equivalent). A stale or legacy client receives HTTP 409 instead of overwriting newer text. Clearing saved text, including serialized empty editor objects, also returns 409. Retrying the exact saved value is safe. Other subject fields retain their existing API contract.

The browser serializes saves per record, advances its comparison base after successful saves, saves only the blurred field, and refreshes clean fields without discarding dirty drafts. Curriculum changes and their audit records commit together. Database triggers retain before/after values in `curriculum_history`, including when a source row is deleted. This history has no cascading foreign keys and is not pruned by rotating SQLite backup retention.

## Read-only diagnosis

Authenticated directors and administrators may call:

```
GET /api/mentoring/curriculum-snapshot?studentIds=179,183,185,214
```

This returns selected students' subjects, week/subject records, source preferences, and subject-record audit logs without running record-page hydration. Keep exports private; they contain student records. The normal record endpoint initializes missing data and should not be used for a pristine forensic snapshot.

## Offline/Render-shell recovery

Run from the repository root, with an explicit database, week ID (not the displayed round number), and student names:

```sh
node apps/server/scripts/recover-curriculum.mjs --db /var/data/db.sqlite --week 36 --students "유선아,신재희,임나연,이가윤" --backups /var/data/backups --report /var/data/curriculum-recovery-plan.json
```

Planning opens databases read-only. It searches same-week history/audit records, earlier weeks, and backups; validates student/subject identity; skips nonempty targets; and leaves ambiguous versions unresolved. Review the private JSON report before applying. Do not put reports in a public folder or commit them.

```sh
node apps/server/scripts/recover-curriculum.mjs --db /var/data/db.sqlite --apply-plan /var/data/curriculum-recovery-plan.json
```

Applying first creates a consistent SQLite safety backup beside the report (keep this outside rotating backup directories). One transaction rechecks every target and changes only its `a_curriculum`. It hashes all other table content before/after, rolling back if anything unrelated changes. This full verification can take time on databases containing large image tables. If a target was edited since planning, regenerate the plan instead of forcing an overwrite. Original timestamps and other fields are preserved by this CLI; normal API saves update their usual author/time metadata.

Validation: `node --test apps/server/test/*.test.js` and `npm run build --workspace apps/web`.
