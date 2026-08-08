# MoneyTracker

A local-first Income / Expense / Transfer / Loan tracker. No backend — everything
lives in your browser's IndexedDB, and you export/import an Excel file whenever
you want a backup or want to move data between devices.

## Files

```
MoneyTracker/
├── index.html          ← page shell + sidebar/bottom nav + mobile top bar
├── style.css            ← design system
├── app.js                ← IndexedDB, views, loan scheduling, Excel import/export
├── manifest.json          ← home-screen / PWA metadata
├── icon-192.png, icon-512.png, apple-touch-icon.png  ← home-screen icons
```

## Run it locally in VS Code

1. Open the `MoneyTracker` folder in VS Code.
2. Install the **Live Server** extension (or any static file server) —
   IndexedDB and ES modules generally want `http://`, not `file://`.
3. Right-click `index.html` → **Open with Live Server**.

## Put it on GitHub so it opens on your phone too

1. Create a new GitHub repo (e.g. `money-tracker`) and push this folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<you>/money-tracker.git
   git push -u origin main
   ```
2. In the repo: **Settings → Pages → Source → Deploy from branch → `main` / root**.
3. After a minute, your app is live at `https://<you>.github.io/money-tracker/`.
   Open that URL on your phone and **Add to Home Screen** — the app now has a
   manifest and icons, so it opens full-screen (no browser address bar) like a
   real installed app, on both iOS and Android.

**Important:** IndexedDB is per-browser, per-device — your phone and laptop each
have their own local copy. Use **Export Excel** on one device and **Import Excel**
on the other to sync data between them (importing replaces all existing data).
Export, Import, and **Clear Transaction** are all reachable from the mobile top
bar (icon buttons on the right), not just the desktop sidebar.

## A few implementation notes / assumptions

- **Logo** is the Philippine Peso sign (₱).
- **Clear Transaction** (sidebar + mobile top bar) opens a checklist of Income,
  Expense, Transfer, and Loan. Only the checked types are permanently deleted;
  checking Loan removes both the release and payment lines for every loan.
- **Income / Expense forms**: Date, Account, Amount, Category, SubCategory,
  Remarks, laid out as Date / Account+Amount / Category+SubCategory / Remarks.
  The Account field autocompletes from every Account used in *any* Income,
  Expense, or Transfer transaction (so "BPI Savings" suggests whether you're
  logging income into it or an expense out of it). Category/SubCategory
  autocomplete **only from that same transaction type** — Income categories
  don't leak into the Expense form's suggestions and vice versa. Income writes
  the Account into `toAccount`; Expense writes it into `fromAccount`. Both
  views have an Account + Category filter above the table.
- **Transfer form**: Date, From Account, To Account, Amount, Remarks — laid
  out as Date / From+To Account / Amount / Remarks. Both account fields share
  the pooled suggestion list described above.
- **All Income, Expense, and Transfer rows are editable** — click a row to open
  it pre-filled; delete is available both inline and inside the edit form.
  Loans are editable too (✎ on the Loan table, or **Edit Loan** in the loan
  detail view); editing keeps the loan's original `code` so existing payments
  stay linked to it.
- **Code** is auto-built as `Account-Debtor-Amount` exactly as specified; if
  that exact combination already exists, a `-2`, `-3`, … suffix is appended
  so every loan keeps a unique code (codes are the join key between the
  release lines and every payment line).
- **Remarks packing** on the loan's "Net Amount" line follows this pipe order:
  `InterestRate|RepaymentAmount|Frequency|RepaymentCount|RepaymentDate(s)|StartPaymentDate|UserRemarks`.
  Semi-Monthly stores both dates as `15,30`. Loans saved before this field
  existed just fall back to the release date as the schedule anchor.
- **Add Loan** now includes a **Start Payment Date**. The repayment day(s)
  (e.g. "5" or "5 & 20") are read as a day-of-month, anchored to the Start
  Payment Date — e.g. start date Oct 5, 2026 with days 5 & 20 schedules
  Oct 5, Oct 20, Nov 5, Nov 20, …
- **Loan table** columns: `#, Date Released, Debtor, Account, Amount,
  Repayment Date, Repayment Amount, Balance`. A filter row above it narrows
  by Debtor, Account, and Balance (all / = 0 / > 0), each a dropdown of
  existing values.
- **Loan balance** = (Amount + Interest) − sum of all "Loan Payment" lines for
  that code. Fees reduce what's disbursed (Net Amount) but aren't part of what
  the debtor owes back.
- Unchecking a "Paid" box in the loan detail view deletes that date's payment
  transaction(s) — an easy undo if you tick the wrong row.
- **Report** shows one row per account (Income / Expense / Transfer / Balance),
  built only from Income, Expense, and Transfer transactions — Loans are not
  included anywhere on this screen. You can create named **groups** and assign
  accounts to them from **+ New Group**; a group's summary row shows only its
  combined **Balance** (Income/Expense/Transfer are blank on that row — expand
  the group to see each member account's full breakdown). Balance = Income −
  Expense + Transfer. Groups are stored separately from your transactions, so
  **Import Excel does not touch them**.
- The old "Total Income / Total Expense / Net" cards are replaced by a single
  **Balance Wallet** card. Tap it to check/uncheck which accounts count toward
  that total (defaults to every account); the selection is saved and persists
  across sessions.
- **Import Excel clears all existing data first**, per your spec — you'll get
  a confirmation prompt before that happens.
