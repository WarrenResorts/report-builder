# Agent Rules

Rules that must be followed in every session without exception.

## Git

- **Never** run `git add`, `git commit`, or `git push` without explicit instruction from the user.
- After completing changes, state what is ready and stop. Wait for the user to say to commit and/or push.
- This applies even when changes are fully verified and tests are passing.

## Code Quality

- Always run `npm run build`, `npm run lint`, `npm run format:check`, and `npm test` before declaring changes ready.
- Never lower coverage thresholds.
