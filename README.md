# IBA Time Clock

Clock in/out and timesheets for school and church staff, replacing Connecteam.
Phase 1 of `notes/iba-timeclock-plan.md` in Garrett's claude-remote repo.

- **App:** https://time.ibakings.org/ (GitHub Pages, published by `.github/workflows/pages.yml`
  on every push to `main`; DNS-only CNAME `time` → `guarantee418.github.io` in the ibakings.org DNS).
- **Sign-in:** school Microsoft 365 accounts, through the same "IBA Boards" app registration
  (already approved for the school), so staff approve nothing new.
- **Data:** SharePoint lists on the private site
  https://ibaministries.sharepoint.com/sites/ibatimeclock, owned by the "IBA Time Clock"
  Microsoft 365 group. This repo holds code only, never data.

No servers and nothing to pay for.

## Who can do what

| | Staff (group members) | Admins (group owners) |
| --- | --- | --- |
| Punches | add and see **only their own** (item-level permissions) | see and fix everyone's |
| Staff, Locations, Jobs, Settings, Approvals | read only | edit |

To add someone: add them to the **IBA Time Clock** group (owners for admins), then add them
under **Settings → Staff** in the app with the same school email.

Being an admin in the app's Staff list only changes what the app shows; what a person can
actually read or change is decided by the SharePoint permissions above.

## How it works

- **Punch time** is SharePoint's own server clock (the item's created time), not the phone's.
- **Location** is read from the phone only when someone clocks in or out, compared with the
  job's worksite (or the nearest one). Outside the radius: flagged for review or refused,
  per worksite. No tracking between punches.
- **Shifts** are built from punches (in → breaks → out). Flags: outside the worksite, no
  location, no clock-out (after 16 h), break never ended, entered or changed by an admin,
  edited by the staff member outside the app.
- **Approvals** lock a person's pay period; admins can undo.
- **Export for payroll** downloads a CSV of every shift in the period (QuickBooks export is
  Phase 5).

## Run it on this Mac

```bash
npm install
npm run dev     # http://localhost:5175/ (real data, signs in)
```

http://localhost:5175/?demo previews with made-up data as an admin, `?demo=staff` as staff.

## One-time setup (already done)

`npm run setup` (scripts/setup_sharepoint.py) creates the group, site and lists, makes the
signed-in admin the first clock admin, and allows the sign-in at time.ibakings.org.
List permissions are set by hand in SharePoint (see "Who can do what").
