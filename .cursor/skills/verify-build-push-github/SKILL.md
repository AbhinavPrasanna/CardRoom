---
name: verify-build-push-github
description: >-
  Runs the project build to verify it passes, then stages all changes, commits,
  and pushes to the current Git branch on GitHub. Use when the user wants to
  push to GitHub, ship changes, sync the branch, or explicitly asks to verify
  build then add/commit/push.
---

# Verify build, then push to GitHub

## When to use

Apply this workflow when the user wants changes on GitHub **after** confirming the project still builds.

## Preconditions

- Repository is a git checkout with `origin` pointing at GitHub (or the intended remote).
- The user has auth for `git push` (SSH key, credential helper, or GitHub CLI) already working on their machine.

## Workflow (order matters)

1. **Current branch**  
   Run `git branch --show-current` and remember the branch name. Do not switch branches unless the user asked to.

2. **Build**  
   - From the repo root, run the project’s primary build command (usually `npm run build`, `pnpm build`, or `yarn build` — follow `package.json` `"scripts"`.build if present).  
   - If there is no `build` script but there is `test`, run tests instead; if both exist, run **build first**, then tests only if the user cares about tests.  
   - **If the build fails: stop.** Report errors, suggest fixes, and **do not** `git push`. Optionally run `git status` so the user sees what would have been committed.

3. **Working tree**  
   Run `git status`. If there is nothing to commit (clean and no untracked meaningful changes), tell the user and **do not** create an empty commit unless they explicitly ask.

4. **Stage everything**  
   Run `git add -A` from the repo root so all tracked changes and new files are staged (respects `.gitignore`).

5. **Commit**  
   - If nothing is staged after `git add -A`, stop after step 3.  
   - Otherwise create a commit with a **clear, accurate message** derived from the diff (conventional commits optional: `feat:`, `fix:`, etc.).  
   - If the user supplied an exact commit message, use it verbatim.

6. **Push**  
   `git push origin <current-branch>`  
   Use `git push -u origin <branch>` when upstream is not set yet.  
   **Do not** `git push --force` or `--force-with-lease` unless the user explicitly requests it.

## Safety rules

- Never push before a **successful** build (step 2).  
- Do not skip `git add` and push old commits only — the user asked to include **current** file changes.  
- Do not print secrets, tokens, or `.env` contents.  
- If `pre-push` hooks exist and fail, report output and stop; do not bypass hooks unless the user explicitly asks.

## Build troubleshooting (optional)

If `npm run build` fails with **permission denied** on `node_modules/.bin/tsc`, try running TypeScript directly, e.g. `node ./node_modules/typescript/bin/tsc -b` then the bundler step from `package.json`, or fix execute permissions on `node_modules/.bin/*` — only apply what matches the user’s environment.

## Checklist

```text
- [ ] On correct branch
- [ ] Build passed
- [ ] git add -A
- [ ] Commit with good message
- [ ] git push origin <branch>
```
