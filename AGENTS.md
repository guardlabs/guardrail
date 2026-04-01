# Repository Instructions

## README, Docs, And Homepage Maintenance

Keep the root `README.md`, the Markdown docs under `docs/`, and the frontend homepage accurate whenever the repository changes in a way that affects external understanding or day-to-day developer usage.

Update the `README.md`, the relevant files in `docs/`, and the frontend homepage when you change:
- the purpose or positioning of the project,
- the end-to-end user flow,
- supported chains,
- CLI commands or their expected usage,
- local development steps,
- required environment variables,
- package names, hosted URLs, or deployment assumptions,
- repository layout in a way that changes how contributors navigate the codebase.

Do not let the `README.md`, docs, or homepage drift behind the implementation. If a user-facing or contributor-facing workflow changes, update the relevant sections in the same task.

Keep both surfaces lean:
- prefer updating existing sections over adding new ones,
- do not turn it into a changelog,
- do not document every internal detail,
- keep examples realistic and consistent with the current codebase,
- use placeholders only when the real deployment values are not decided yet.

Use the surfaces intentionally:
- keep `README.md` as the short entry point,
- put detailed explanations and navigable reference material in `docs/`,
- keep the homepage aligned with the current positioning and quickstart, but do not turn it into the full documentation set.
