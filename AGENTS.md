# Repository Instructions

## README, Docs, And Homepage Maintenance

Keep the root `README.md`, the Markdown docs under `docs/`, and the frontend homepage accurate whenever the repository changes in a way that affects external understanding or day-to-day developer usage.

Keep `docs/product.md` accurate as the concrete description of what Guardrail currently does as a product. Update it whenever changes affect:

- the product boundary or service we provide,
- the human / agent / backend responsibility split,
- the wallet lifecycle or provisioning flow,
- the runtime policy surface,
- the trust model,
- the primary supported use cases,
- what is intentionally out of scope in the current product shape.

Keep `apps/frontend/public/skill.md` accurate as the public agent-readable onboarding skill for Guardrail. Update it whenever changes affect:

- how an agent should create a wallet request,
- which chains or backend pairing rules are supported,
- how provisioning and passkey setup work,
- how funding and readiness checks work,
- required CLI commands, flags, or environment variables,
- any gotchas or limitations that would cause an agent following the skill to fail.

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
