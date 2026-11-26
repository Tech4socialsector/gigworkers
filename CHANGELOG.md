# Changelog

All notable changes to Gigworkers are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions 0.x were development
releases, in which minor versions could include breaking changes. 1.0.0 is the first stable release.
Each version has a detailed write-up in [docs/releases/](docs/releases/).

## [Unreleased]

_Nothing yet._

## [1.0.0] - 2026-11-16

### Added
- Role-based **Home page** (`welfare-home`) with to-dos and recent activity for each role.
- **Welfare Board Dashboard**, with filters, drill-down tables, CSV export, a per-worker or
  per-aggregator timeline, and an analytics tab.
- Aggregator Dashboard and **My Dashboard** (gig worker) rebuilt on the same shared engine.

### Changed
- Aggregator Approval page redesigned with a full application review panel.
- Aggregator registration form shows service category names and has an updated layout.
- Service Categories and Vehicle Types use readable IDs (`SC###`, `VT###`).
- Automatic approval days and maximum adjustments are now both set in **Gig Worker Settings**.

### Fixed
- Welfare Fund Report figures and layout.
- Order of entries in the service rate log.

### Security
- Only the Welfare Board can change welfare rates.
- Dashboard data scope is decided on the server from the user's role.

### Technical
- New pages `welfare-home` and `welfare-board-dashboard`. The `admin-dashboard` page is removed.
- Desk scripts are delivered as bundles. The aggregator web form script is loaded through
  `webform_include_js`.
- Patches: `merge_settings_into_gig_worker_settings`, `rename_service_category_vehicle_type_ids`.

### Breaking Changes
- `/desk/admin-dashboard` is replaced by `/desk/welfare-board-dashboard`.
- *Aggregator Approval Settings* and *Gig Transaction Settings* are removed. Their values are
  migrated to Gig Worker Settings.
- Service Category and Vehicle Type IDs are renamed. External systems and import files that use
  the old IDs must be updated.

### Migration Notes
- Run `bench migrate`, then `bench build` and `clear-cache`. Check Gig Worker Settings afterwards.

### Contributors
- jenifarazim, Nishanth Clinton A

### References
- [v0.8.0...v1.0.0](https://github.com/Tech4socialsector/gigworkers/compare/v0.8.0...v1.0.0) ·
  [Release document](docs/releases/v1.0.0.md)

## [0.8.0] - 2026-10-22

### Changed
- When an invoice is paid, each worker's fund is credited once, through the fee payment. Cheque
  and cash payments are recorded as *Offline*.
- New number cards: My Completed Transactions and Total Welfare Fee Payment.
- Users stay on their own role's workspace sidebar.

### Fixed
- Welfare fees were credited twice when an invoice was fully paid.
- Records shown to the wrong roles. Dashboard statistics.

### Security
- Field-level permissions on status and amount fields of Welfare Fee Payment, Welfare Fee Invoice
  and Welfare Benefit Withdrawal.

### Breaking Changes
- Gig Transaction fields `base_payout`, `deduction` and `incentives` removed.

### Contributors
- jenifarazim

### References
- [v0.7.0...v0.8.0](https://github.com/Tech4socialsector/gigworkers/compare/v0.7.0...v0.8.0) ·
  [Release document](docs/releases/v0.8.0.md)

## [0.7.0] - 2026-08-24

### Added
- Automatic **Gig Worker Unique ID** generation from ID proofs.
- A worker can be linked to **multiple aggregators**, with a partner ID for each.

### Changed
- ID-proof fields used in the unique ID are mandatory.
- Aadhaar numbers are always shown with only the last 4 digits visible.
- Gig worker import supports several aggregators per worker.

### Security
- Import job progress is visible only to the user who started the job, and to administrators.

### Technical
- New child DocType Worker Aggregator Detail.
- Patches: `snapshot_worker_partner_mapping_before_restructure`,
  `migrate_worker_partner_mapping_to_child_table`.

### Breaking Changes
- Worker Partner Mapping is restructured to one record per worker, with an aggregator table. Data
  is migrated by the patches.

### Contributors
- jenifarazim, Nishanth Clinton A

### References
- [v0.6.0...v0.7.0](https://github.com/Tech4socialsector/gigworkers/compare/v0.6.0...v0.7.0) ·
  [Release document](docs/releases/v0.7.0.md)

## [0.6.0] - 2026-07-31

### Added
- Partner ID and **Worker Partner Mapping**.
- **Gig Worker Unique ID Settings.**
- Automatic approval of aggregator applications after a set number of days.
- **Admin Summary Report** and **Welfare Fund Report**.
- Aggregator Dashboard monthly trend and auto-refresh.
- **Board Secretary** role.

### Changed
- Welfare rate and cap are saved on each transaction when it is recorded.
- Rate history shows Active / Scheduled / Expired status.
- Sample gig worker import template updated.

### Fixed
- Service form and rate history issues. Import log on the bulk upload page.

### Security
- Random initial passwords for new accounts.
- One-time passwords are hashed, with expiry, attempt limits and rate limits.
- Aggregators cannot mark their own transactions as paid.
- Sensitive identity and bank fields are restricted to authorised roles.
- Import files are checked for owner, type and size (maximum 50 MB).

### Migration Notes
- Ask users whose accounts were created before this release to reset their passwords.

### Contributors
- jenifarazim, Nishanth Clinton A

### References
- [v0.5.0...v0.6.0](https://github.com/Tech4socialsector/gigworkers/compare/v0.5.0...v0.6.0) ·
  [Release document](docs/releases/v0.6.0.md)

## [0.5.0] - 2026-06-26

### Added
- *Pending with Clarification* step in aggregator approval.
- Aadhaar masking on gig worker records and in the aggregator list.
- List views for the gig worker and gig transaction import logs.

### Changed
- Registration certificate redesigned, with the Karnataka seal.
- Amounts shown in ₹.
- Aggregator registration form updated after review.

### Fixed
- Gig worker record creation error. Transaction import issues.

### Breaking Changes
- Aggregator status *Rejected* is removed.

### Contributors
- jenifarazim, Nishanth Clinton A

### References
- [v0.4.0...v0.5.0](https://github.com/Tech4socialsector/gigworkers/compare/v0.4.0...v0.5.0) ·
  [Release document](docs/releases/v0.5.0.md)

## [0.4.0] - 2026-05-27

### Added
- **Bulk Gig Worker Import** and **Bulk Gig Transaction Import** pages.
- Gig Worker Import Log and Gig Transaction Import Log.
- Drill-down on all dashboards.
- Aggregators can use Frappe Data Import.

### Changed
- Aggregator Dashboard redesigned, with monthly trend and service category breakdown.
- The Add Gig Worker button is hidden on the gig worker list.
- Outgoing notification emails have an explicit sender.

### Fixed
- Bulk action on suspected duplicate transactions. Import errors. Certificate alignment.
  Migration error on Gig Transaction.

### Breaking Changes
- Gig Transaction field `trust_level` removed.
- Worker Mapping Log DocType removed.

### Migration Notes
- Patch: `add_aggregator_data_import_permission`.

### Contributors
- Nishanth Clinton A, jenifarazim

### References
- [v0.3.0...v0.4.0](https://github.com/Tech4socialsector/gigworkers/compare/v0.3.0...v0.4.0) ·
  [Release document](docs/releases/v0.4.0.md)

## [0.3.0] - 2026-05-05

### Added
- **Transaction adjustments**, with an adjustment log and a configurable limit.
- Invoice summary section.
- Multiple service categories per aggregator.

### Fixed
- Permission errors on Aggregator and Welfare Fee Invoice. Error when Gig Transaction Settings were
  missing.

### Technical
- Frappe dependency declared as `>=16.0.0,<18.0.0` for Frappe Cloud.

### Breaking Changes
- Grievance portal and grievance DocTypes removed.
- *Doctypes Flow* workspace removed.

### Migration Notes
- Patch: `create_default_gig_transaction_settings`.

### Contributors
- Nishanth Clinton A

### References
- [v0.2.0...v0.3.0](https://github.com/Tech4socialsector/gigworkers/compare/v0.2.0...v0.3.0) ·
  [Release document](docs/releases/v0.3.0.md)

## [0.2.0] - 2026-04-29

### Added
- **Welfare Fee Invoice**, with quarterly generation and overdue reminders.
- **Board Management** module: members, agendas and minutes.
- Grievance portal.
- Gig transactions and number cards on Welfare Fund Accounts.
- Multiple services per aggregator, and a rejection reason field.

### Fixed
- `$` symbol replaced. Gig worker permission errors.

### Migration Notes
- Patch: `backfill_ledger_gig_transaction`. Enable the scheduler.

### Contributors
- Nishanth Clinton A, jenifarazim

### References
- [v0.1.0...v0.2.0](https://github.com/Tech4socialsector/gigworkers/compare/v0.1.0...v0.2.0) ·
  [Release document](docs/releases/v0.2.0.md)

## [0.1.0] - 2026-04-16

### Added
- Aggregator registration and approval, with status emails and a registration certificate.
- Gig worker registration, with a portal login.
- Service categories, vehicle types and the welfare rate card.
- Gig transactions with automatic welfare fee, duplicate detection and OTP confirmation.
- Welfare Fee Payment, Welfare Fund Account and Welfare Benefit Withdrawal.
- Admin, Aggregator and Gig Worker dashboards.
- Quarterly Welfare Compliance Report and Service Rate History.
- Public registration forms. Aggregator and Gig Worker roles.

### Contributors
- Nishanth Clinton A, jenifarazim

### References
- [Release document](docs/releases/v0.1.0.md)

[Unreleased]: https://github.com/Tech4socialsector/gigworkers/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Tech4socialsector/gigworkers/releases/tag/v1.0.0
[0.8.0]: https://github.com/Tech4socialsector/gigworkers/releases/tag/v0.8.0
[0.7.0]: https://github.com/Tech4socialsector/gigworkers/releases/tag/v0.7.0
[0.6.0]: https://github.com/Tech4socialsector/gigworkers/releases/tag/v0.6.0
[0.5.0]: https://github.com/Tech4socialsector/gigworkers/releases/tag/v0.5.0
[0.4.0]: https://github.com/Tech4socialsector/gigworkers/releases/tag/v0.4.0
[0.3.0]: https://github.com/Tech4socialsector/gigworkers/releases/tag/v0.3.0
[0.2.0]: https://github.com/Tech4socialsector/gigworkers/releases/tag/v0.2.0
[0.1.0]: https://github.com/Tech4socialsector/gigworkers/releases/tag/v0.1.0
