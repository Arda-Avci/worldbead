# Agent rules for this repo

- Read `Memory_Bank.md` first, at the start of every session.
- YAGNI: build only what was asked for. No speculative features, frameworks,
  or abstractions "for later".
- No mocks, stubs, or bypasses that pretend something works. If a step can't
  actually run (e.g. no Android SDK locally), say so instead of faking it.
- All code, commit messages, and docs are written in English.
- Never run `git add -A` or `git add .`. Stage specific file paths only.
- Do not commit or push unless explicitly asked to in the current request.
- Destructive operations (force-push, `git reset --hard`, deleting files or
  branches, rewriting history) require explicit human approval first.
- Run `npm run build` before reporting a task as done; fix any type or build
  errors it surfaces.
- Native builds (Android/iOS) run in GitHub Actions, not locally — this
  project has no local Android SDK, Xcode, or Unity.
- Keep `Memory_Bank.md` up to date when you make a decision or leave
  something open for a future session.
