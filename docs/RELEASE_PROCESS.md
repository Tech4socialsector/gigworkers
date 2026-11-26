# Gigworkers Release Process

This guide describes how to prepare, tag and publish a release of the Gigworkers Frappe app.
Released versions so far: v0.1.0 to v0.8.0 (development releases) and v1.0.0 (first stable
release). See [releases/README.md](releases/README.md).

**Guiding rule:** release notes describe what the code does, not what the commit messages say.
Check every item against the diff.

---

## 1. Roles and responsibilities

| Role | Responsibility |
|---|---|
| Release owner (a developer) | Reviews the history, writes the documents, creates the tag |
| Reviewer (a second developer) | Checks the documents against the diff; runs the staging tests |
| Welfare Board / product owner | Approves the release and the administrator actions it requires |

## 2. Branching and commit conventions

- `main` is the default and release branch. Every release is a tag on `main`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages and PR
  titles: `feat(scope): …`, `fix(scope): …`, `refactor`, `perf`, `docs`, `chore`, `build`, `ci`,
  `test`. Mark breaking changes with `!` (`feat(api)!: …`) or a `BREAKING CHANGE:` footer.
- Prefer pull requests over direct pushes, so each change has a reviewable reference. Add one
  label per PR (see [§9](#9-github-release-configuration)) so GitHub can group the generated notes.
- Use the module names from `docs/releases/TEMPLATE.md` as scopes where possible (for example
  `gig-transaction`, `welfare-fund`, `import`, `dashboard`, `web-form`, `security`).

## 3. Choosing the version number (Semantic Versioning)

| Bump | When | Examples in this app |
|---|---|---|
| **MAJOR** `X.0.0` | Anything that needs developers or administrators to step in, or that breaks existing data, integrations or routes | Removing or renaming a DocType, field or page route; changing a whitelisted method's parameters or response; renaming record IDs; a new required site config |
| **MINOR** `1.Y.0` | New features that do not break anything | New DocType, report, dashboard card, optional field, new API method, new setting with a safe default |
| **PATCH** `1.1.Z` | Bug fixes only | Calculation fix, validation fix, report correction, permission bug fix that does not remove legitimate access |

Notes:

- A **security fix** is normally a PATCH. If it removes access that users relied on, it is a
  MAJOR change, or at least needs an administrator-action note.
- A **patch file** (`patches.txt`) does not force a MAJOR bump on its own. Ask instead whether
  existing data, integrations or user workflows have to change.
- Do not re-use or move a published tag. If a tag is wrong, release the next PATCH version.

## 4. Preparing a release

### 4.1 Review the Git history
```bash
cd apps/gigworkers
git fetch upstream --tags
PREV=$(git describe --tags --abbrev=0 upstream/main)   # e.g. v1.0.0
git log --oneline --no-merges ${PREV}..upstream/main
git diff --stat ${PREV}..upstream/main
git diff ${PREV}..upstream/main -- gigworkers/patches.txt gigworkers/hooks.py pyproject.toml
git log --diff-filter=D --name-only --format='>> %h %s' ${PREV}..upstream/main -- '*.json'  # removed DocTypes, pages, reports
```

### 4.2 Build a change inventory
For each commit or PR, open the diff and record:

- **Module:** use the module list in the template.
- **Category:** Added / Changed / Fixed / Security / Technical / Breaking.
- **What a user sees:** one plain sentence.
- **Roles affected** and **administrator action**.
- **References:** commit SHA and PR number.

Look in particular at:

- `*/doctype/*/*.json`: new, removed or renamed fields, `reqd`, `permlevel`, `permissions`,
  `autoname`.
- `patches.txt` and `patches/*.py`: what each patch changes, and whether it is safe to re-run.
- `hooks.py`: scheduler events, permission hooks, fixtures, includes.
- `@frappe.whitelist` signatures: API contract changes and `allow_guest`.
- `fixtures/*.json`: roles, workspaces, web forms, number cards, reports.
- `pyproject.toml`: the Frappe version range and dependencies.

### 4.3 Write the documents
1. **CHANGELOG.md:** turn `## [Unreleased]` into `## [X.Y.Z] - YYYY-MM-DD`, add a new empty
   `[Unreleased]` above it, and update the compare links at the bottom.
2. **docs/releases/vX.Y.Z.md:** copy `TEMPLATE.md` and fill in every section. This file is also
   the GitHub Release description, so write it for users and administrators, not developers.
3. **RELEASE_NOTES.md:** replace the whole file with the new release's stakeholder summary. Only
   the latest release goes here; older ones live in `docs/releases/`.
4. **docs/releases/README.md:** add a row to the index.
5. **App version:** set `__version__` in `gigworkers/__init__.py` to `X.Y.Z`.
6. Open a PR titled `chore(release): vX.Y.Z` with these changes only.

### 4.4 Quality checklist (the reviewer signs off)
- [ ] Every documented feature, fix and breaking change was checked against the diff.
- [ ] Every commit and PR reference resolves on GitHub.
- [ ] No item is listed twice, or in two categories.
- [ ] Each migration step matches a line in `patches.txt`.
- [ ] Breaking changes are listed in all three documents, with the action required.
- [ ] Release notes contain only what changed in this version: no open bug lists, internal
      notes, TODOs or HTML comments.
- [ ] No personal data, credentials, email addresses, tokens or internal hostnames appear.
- [ ] The version bump matches the SemVer rules in §3.

## 5. Testing the release

Run these on a **staging site restored from a recent production backup**:

```bash
bench --site staging restore <database.sql.gz> \
  --with-public-files <files.tar> --with-private-files <private-files.tar>
bench --site staging migrate          # every new patch must succeed
bench build --app gigworkers
bench --site staging run-tests --app gigworkers
```

Then run these manual smoke tests, once per role (System Manager, Aggregator, Gig Worker):

- Home page and the role's dashboard load, and show only that user's own data.
- Aggregator web form submission → Aggregator Approval → approval email.
- Gig worker creation and unique ID generation.
- Gig transaction creation → welfare fee → Welfare Fee Payment → Completed → fund credit.
- Quarterly invoice generation (`generate_quarterly_invoices`, run manually) and recording a
  payment.
- Welfare Benefit Withdrawal: request → approve → paid (fund debit).
- Bulk worker and transaction import using the downloaded templates.
- The four reports run without errors.

## 6. Creating the Git tag

Only after the release PR is merged and approved:

```bash
git checkout main && git pull upstream main
git tag -a vX.Y.Z -m "Gigworkers vX.Y.Z"
git push upstream vX.Y.Z
```

- Tags are annotated, prefixed with `v`, and point at the merged release commit on `main`.
- Never force-push or move a tag once it has been pushed.

## 7. Publishing the GitHub Release

1. On GitHub, go to **Releases → Draft a new release** and choose the tag `vX.Y.Z`.
2. Title: `Gigworkers vX.Y.Z – <short title>`.
3. Body: paste `docs/releases/vX.Y.Z.md` without its first heading line (GitHub shows the title
   separately). Optionally, click **Generate release notes** (this uses `.github/release.yml`) to
   append the list of merged PRs.
4. Leave **Set as the latest release** ticked. Use **Set as a pre-release** for `-rc` / `-beta`
   tags.
5. Publish, then announce to stakeholders with a link to `RELEASE_NOTES.md`.

### 7.1 Publishing the existing releases (one-time)

The nine releases already written are tagged on these commits of `upstream/main`. Create the tags
from a clone whose `main` matches `upstream/main`:

```bash
git fetch upstream
git tag -a v0.1.0 d1dc516 -m "Gigworkers v0.1.0 – Welfare Portal Foundation"
git tag -a v0.2.0 ed424a3 -m "Gigworkers v0.2.0 – Welfare Fee Invoicing and Board Management"
git tag -a v0.3.0 93ea69f -m "Gigworkers v0.3.0 – Transaction Adjustments"
git tag -a v0.4.0 98915b7 -m "Gigworkers v0.4.0 – Bulk Import"
git tag -a v0.5.0 1e93f3b -m "Gigworkers v0.5.0 – Aggregator Approval Workflow and Aadhaar Masking"
git tag -a v0.6.0 e30ae5e -m "Gigworkers v0.6.0 – Partner IDs, Reports and Security Hardening"
git tag -a v0.7.0 2fed57a -m "Gigworkers v0.7.0 – Gig Worker Unique ID and Multiple Aggregators"
git tag -a v0.8.0 7a5b75b -m "Gigworkers v0.8.0 – Welfare Fee Settlement Correction"
git tag -a v1.0.0 ee130c1 -m "Gigworkers v1.0.0 – Role-based Home and Welfare Dashboards"
git push upstream v0.1.0 v0.2.0 v0.3.0 v0.4.0 v0.5.0 v0.6.0 v0.7.0 v0.8.0 v1.0.0
```

Then publish one GitHub Release per tag, **oldest first**, so that v1.0.0 ends up marked as the
latest release. Use the title from the tag message and the matching `docs/releases/vX.Y.Z.md` as
the body. If the docs commit is merged before tagging and you want v1.0.0 to include it, tag that
merge commit for v1.0.0 instead of `ee130c1`.

## 8. Deploying

Follow the release document's *Deployment instructions*: back up → update the app to the tag →
`migrate` → `build` → `clear-cache` → `restart`, then run the post-deployment checks. On Frappe
Cloud, deploy the tagged commit.

**Rollback:** restore the pre-deployment backup and check out the previous tag. Patches cannot be
reversed automatically.

## 9. GitHub release configuration

`.github/release.yml` groups automatically generated release notes by PR label:

| Label | Section |
|---|---|
| `breaking-change` | ⚠️ Breaking Changes |
| `security` | 🔒 Security |
| `feature`, `enhancement` | 🚀 New Features & Improvements |
| `bug`, `fix` | 🐛 Bug Fixes |
| `database`, `migration` | 🗄️ Database & Migrations |
| `documentation` | 📝 Documentation |
| `dependencies` | 📦 Dependencies |
| _(anything else)_ | 🧰 Other Changes |

PRs labelled `skip-changelog`, `ci` or `chore`, and PRs from bots, are left out. **Create these
labels in the repository** (Settings → Labels) before the first PR-based release. Generated notes
only list merged PRs, so direct pushes to `main` will not appear. This is one more reason to merge
through PRs.

## 10. Maintaining the changelog

- Add to `## [Unreleased]` **as part of each feature PR**, not at release time.
- Use the headings Added / Changed / Fixed / Security / Technical / Breaking Changes / Migration
  Notes. Leave out empty headings in normal releases.
- Write for a reader who does not know the code. Name the module and the effect, then give the
  reference.
- Never edit the entry of a published version, except to fix a factual error. If you do, add a
  note saying what changed.
