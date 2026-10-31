# Launch checklist

Nothing in this checklist authorizes publication. The operator owns commits and all release/network steps.

- [ ] Review `git diff`; commit only source, documentation, CI, and synthetic artifacts. Never commit real logs or real-log output, including redacted output. Keep `reports/` gitignored.
- [ ] Run `npm ci` and `npm test` on the macOS/Linux/Windows × Node 18/20/22 matrix. Review CI results; a configured workflow is not a passed run.
- [ ] Run `npm run test:package` (builds, packs, checks whitelist, installs offline into a temp directory, tests both bins and a fixture report).
- [ ] On clean machines, run `npx node@18 --version` / `npx node@20 --version` and run tests with those runtimes (registry access may be needed). Application runtime APIs target Node 18.0; the test runner uses the maintained Node 18 line.
- [ ] Manually verify `--open` on macOS, Linux, and Windows with a local file containing spaces and punctuation. The unit tests only verify command construction and never launch browsers.
- [ ] Confirm README sample image/HTML contain synthetic data only and the quickstart paths match the installed tarball.
- [ ] Check repository URL, license, maintainer identity, package-name availability, and npm account/2FA. Enable GitHub private vulnerability reporting.
- [ ] At the explicitly approved publish step, **remove `"private": true` from package.json**. Keep `publishConfig: {"access":"public"}`. Repack and inspect the exact release tarball; check that `dist/test`, fixtures, `reports/`, and real data are absent.
- [ ] Publish only after separate explicit authorization; this launch-prep task does not publish, tag, or push.
- [ ] After publication, verify `npx token-leak-finder --help` and a redacted fixture run from a clean directory, then update the README's unpublished-release status note.
