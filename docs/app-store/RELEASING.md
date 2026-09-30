# Releasing to the App Store

## One-time setup (Apple account holder)

1. **Register the bundle ID.** developer.apple.com → Certificates, Identifiers &
   Profiles → Identifiers → + → App IDs → App. Use `com.chessscanner.app`, or your
   own (e.g. `com.<yourname>.chessscanner`) and set it as the `BUNDLE_ID`
   repository variable (below). No capabilities are needed.
2. **Create the app record.** appstoreconnect.apple.com → Apps → + → New App:
   iOS, name from `listing.md`, language English (U.S.), the bundle ID from
   step 1, any SKU (e.g. `chessscanner`), Full Access. The name must be unique
   across the App Store. If it's taken, try the fallbacks in `listing.md`.
3. **Create an API key.** App Store Connect → Users and Access → Integrations →
   App Store Connect API → Team Keys → +. Role: **Admin** (needed for
   cloud-managed signing to create the distribution certificate). Download the
   `.p8` file (it can only be downloaded once) and note the Key ID and Issuer ID.
4. **Add GitHub secrets.** Repo → Settings → Secrets and variables → Actions:
   - Secrets: `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`
     (paste the whole `.p8` file, including the BEGIN/END lines).
   - Variable (optional): `BUNDLE_ID`.
5. **Agreements.** App Store Connect → Business: accept the latest Apple
   Developer Program License Agreement. The Free Apps agreement needs nothing
   else; no banking or tax forms are needed for a free app.

## Each release

1. Actions → **Release to App Store Connect** → Run workflow (optionally set the
   version, e.g. `1.1`). The build number is the workflow run number.
2. Wait for processing (5–30 min). The build appears under TestFlight; install
   it on your phone with the TestFlight app to check it.
3. App Store Connect → the app → the version page: fill in the listing from
   `listing.md`, upload the screenshots, pick the build, then **Add for Review**
   → **Submit**. Review usually takes 1–2 days.

## Screenshots

Actions → **App Store screenshots** → Run workflow. It captures 6.9"
screenshots (1320 × 2868) on the simulator and pushes them to
`refs/qa/store-screenshots`:

    git fetch origin +refs/qa/store-screenshots:refs/remotes/qa/store-screenshots
    git archive qa/store-screenshots | tar -x -C screenshots/

To show your own board in the scan screenshot, add the photo under
`ChessScannerUITests/Fixtures/` and point `STORE_PHOTO` at it in
`AppStoreScreenshots.swift`.

## GitHub Actions minutes

While the repo is private, macOS runners use 10× minutes against the free
2,000/month (so about 200 macOS minutes). A release takes about 15, a QA run
about 20. The QA workflow runs on every push to `main` and `claude/**`, so
consider switching it to manual runs until the repo is public again.
