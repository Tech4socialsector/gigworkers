# Gigworkers vX.Y.Z – <Short Title>

**Release date:** YYYY-MM-DD · **Release type:** Major / Minor / Patch · **Previous version:** vA.B.C

## Summary

Two to four plain sentences: what this release does and who benefits.

## Highlights

- The three to six changes users will notice most.

## Changes by module

### <Module name>
- What was introduced or changed, and the problem it solves, in plain language.

## Bug fixes

- What now works correctly, written from the user's point of view.

## Security

- Access, privacy or data-protection improvements. Leave this section out if there are none.

## Technical changes

- New or removed DocTypes, pages, reports and scheduled jobs.
- New patches (the lines added to `patches.txt`).
- Dependency, hook or configuration changes.

## Breaking changes

None.

| Change | Action required |
|---|---|
| | |

## Upgrade instructions

```bash
bench --site <site> backup --with-files
cd apps/gigworkers && git fetch --tags && git checkout vX.Y.Z && cd ../..
bench --site <site> migrate
bench build --app gigworkers
bench --site <site> clear-cache
bench restart
```

What each new patch does, and any checks or administrator actions after upgrading.

**Full changelog:** https://github.com/Tech4socialsector/gigworkers/compare/vA.B.C...vX.Y.Z
