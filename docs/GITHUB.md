# GitHub repository maintenance

This pack has no target repository URL, authenticated GitHub connection or existing remote. Supply them to the implementing agent. Do not infer the GitHub username from the user's display name. Use existing configured authentication; never commit tokens or print credentials.

## Bootstrap

Inspect current Git state/remotes, existing AGENTS.md, protection policies and CI. Preserve uncommitted human work. For a new repository, get explicit owner/name/visibility; private development was discussed as a preference, not a PS requirement. Judges' final visibility/access requirements need confirmation. Configure source structure, README, .gitignore, license notices, lockfile and CI before major implementation.

## Routine loop

Create scoped issues with requirement IDs/acceptance checks. Create feat/ink-renderer, feat/model-conversion, feat/math-parser and other focused branches. Commit actual working increments with descriptive messages such as feat(ink): batch pointer samples per frame or fix(recognition): reject stale equation revisions. Push feature branches and open PRs containing problem, resulting behavior, tests/evidence and relevant limitations. Link the real issue with Closes #N. Keep title/body aligned with final changes.

Supervisor alone integrates accepted agent changes; avoid everyone pushing directly to main. Require passing checks and applicable review before merge. Maintain main as buildable/demoable. Set branch protections when authorized and supported, without changing existing access policy. If enforcement is unavailable, document the team procedure instead of claiming protection is active.

CI: install pinned environment with npm ci; typecheck; lint/format; unit/integration tests; build; production browser smoke/offline test. Add full browser cases as stable tests mature. Use minimal workflow permissions, no secrets in logs and dependency actions pinned according to repository policy. Pull-request builds must not expose deployment credentials to untrusted code.

## Human and agent attribution

Use the configured real author identity. Follow repository conventions for AI assistance disclosure. Do not impersonate teammates or split commits to fake balanced contribution counts. The real 1–3 team members should genuinely own/review meaningful areas. Agent work can support them but cannot prove their individual work automatically.

## Models and release

Keep distributable model/runtime artifacts available in the static deployment. Verify any Git LFS workflow actually retrieves binaries for CI/build/hosting; do not accidentally deploy LFS pointer text. Store source hashes and conversion instructions. README explains model source, license, architecture, classes, preprocessing, limitations and measured selection evidence.

README also covers quick start, Node version, production build/preview, architecture, offline-ready behavior, tests/benchmark reproduction, team responsibilities and public demo link. Maintain THIRD_PARTY_LICENSES.md. Do not claim a source code license covers every third-party weight.

Static hosting needs correct worker/WASM MIME types, HTTPS, asset/base paths, service-worker scope and any chosen isolation headers. Prepare passing release artifacts before publishing; follow explicit repository deployment policy. Public demo is required by the PS, but repository/account/hosting target must be supplied. Do not add a server inference endpoint.

## Ongoing maintenance scope

Within each active implementation session, update issues/PRs, review/CI status, docs and progress. Persistent future monitoring does not happen merely because AGENTS.md requests it; it needs an explicitly configured scheduled job or automation. Do not claim agents will keep running after a session ends. Record blockers and next task so a new session can resume reliably.
