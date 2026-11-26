# Gig Workers Welfare Portal – Release Notes v1.0.0

**Version:** 1.0.0 · **Release date:** 2026-11-16 · **Previous version:** 0.8.0

The full technical note is in [docs/releases/v1.0.0.md](docs/releases/v1.0.0.md), and the
history of every version is in [CHANGELOG.md](CHANGELOG.md).

---

## 1. Release overview

Version 1.0.0 is the **first stable release** of the Gig Workers Welfare Portal. It brings
together eight earlier development releases and adds a home page and dashboards designed for each
type of user, so the Welfare Board, aggregators and gig workers each see what matters to them as
soon as they sign in.

## 2. Major highlights

- **A home page for every role**, listing what needs attention and what has happened recently.
- **New dashboards:** the Welfare Board sees the whole scheme, and each aggregator and gig worker
  sees only their own figures.
- **Faster aggregator review:** the complete application on one screen, with bulk decisions.
- **Welfare rates protected:** only the Welfare Board can change them.
- **Simpler settings:** one settings page for the portal.

## 3. New features

| Feature | What it does |
|---|---|
| Home page | Shows each user their pending tasks and a recent-activity feed |
| Welfare Board Dashboard | A scheme-wide view of workers, transactions, fees, invoices, funds and withdrawals, with filters, drill-down, CSV export and analytics |
| My Dashboard (gig workers) | A worker's own transactions, welfare fees, fund balance and withdrawals |
| Aggregator Dashboard | An aggregator's own workers, transactions, fees and invoices |

## 4. Improvements

- The aggregator review screen shows the full application, documents and days waiting, and
  supports single or bulk decisions.
- The aggregator registration form shows service category names instead of codes.
- Service categories and vehicle types have readable IDs, such as `SC001` and `VT001`.
- Automatic approval and transaction adjustment limits are set on one **Gig Worker Settings**
  page.

## 5. Bug fixes

- The Welfare Fund Report shows the correct figures in a clearer layout.
- Service rate history entries appear in the correct order.

## 6. Security enhancements

- Only the Welfare Board can change welfare rates.
- Each dashboard shows only the data the signed-in user is allowed to see. This is enforced on
  the server.

## 7. Module-wise changes

| Module | What changed in 1.0.0 |
|---|---|
| Role-based Home Page | New home page for administrators, aggregators and gig workers |
| Admin Dashboard | Replaced by the new Welfare Board Dashboard |
| Aggregator Dashboard | Rebuilt, with drill-down and export |
| Gig Worker Dashboard | Rebuilt as My Dashboard |
| Aggregator Approval and KYC | Redesigned review screen with bulk decisions |
| Service Management | Rate changes restricted to the Welfare Board; readable IDs |
| Application Settings | Settings combined into Gig Worker Settings |
| Web Forms and Public Registration | Aggregator form shows service category names and has an updated layout |
| Reports and Analytics | Welfare Fund Report corrected; analytics tab on the Board dashboard |

## 8. Impact on administrators (Welfare Board)

- Start each day on the **Home** page. It lists applications to review, overdue invoices,
  withdrawals to approve or pay, and suspected duplicate transactions.
- Use the **Welfare Board Dashboard** in place of the old Admin Dashboard. Update any bookmarks.
- Review aggregator applications on the redesigned **Aggregator Approval** page.
- After the upgrade, check the values on the **Gig Worker Settings** page.

## 9. Impact on aggregators

- Use the **Home** page and the **Aggregator Dashboard** to follow your workers, transactions,
  welfare fees and invoices.
- Welfare rates can be viewed but not changed.
- Service category and vehicle type codes now look like `SC001` and `VT001`. Download a fresh
  import template, and update any saved spreadsheets or systems that use the old codes.

## 10. Impact on gig workers

- After signing in, the **Home** page shows your recent activity.
- **My Dashboard** shows your transactions, the welfare fees paid for you, your welfare fund
  balance and your withdrawal requests.

## 11. Deployment instructions

For technical staff:

```bash
bench --site <site> backup --with-files
cd apps/gigworkers && git fetch --tags && git checkout v1.0.0 && cd ../..
bench --site <site> migrate
bench build --app gigworkers
bench --site <site> clear-cache
bench restart
```

The upgrade moves the existing settings into Gig Worker Settings and gives service categories and
vehicle types their new IDs automatically. The checks to run afterwards are in
[docs/releases/v1.0.0.md](docs/releases/v1.0.0.md#upgrade-instructions).

## 12. Acknowledgements

Thanks to the development team, Nishanth Clinton A and jenifarazim, and to the Welfare Board
members, aggregators and reviewers whose feedback shaped this release.
