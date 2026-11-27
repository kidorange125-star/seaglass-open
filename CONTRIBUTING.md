# Contributing

Thanks for helping. A few things keep Seaglass safe and easy to work on:

- **Every write to a page goes through `src/worker/notes.ts`** (`createNote`, `patchNote`, `trashNote`…). That's how changes
  are sanitized, checked for conflicts, kept in history and made undoable. Tag the source (`user`, `agent`, `mcp`) and, for
  an agent, which agent (`agentCtx` in `identity.ts`).
- **Private data is encrypted at rest** (`vault.ts`). A new table or column holding anything personal must be sealed and
  opened through `Vault`. SQL can't look inside sealed columns, so search and filtering happen after opening.
- **Hide from AI** is a promise: any feature that sends note content to a model must skip hidden pages (`hidden.ts`).
- **Note content is data, not instructions.** Never let text in a page steer the assistant.
- **Phones**: text fields stay at 16px or larger on touch screens; menus become bottom sheets under 860px wide.
- HTML is sanitized on the server (`sanitize.ts`): new block attributes must be allowed there.

Before opening a pull request, run `npm run typecheck`, `npm run build` and the unit tests in `tests/README.md`, and check
any screen you changed at 390px wide. Describe what changed for the people who use Seaglass, not only the code.
