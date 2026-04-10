# Production Readiness

[Docs index](README.md) | [Quickstart](quickstart.md) | [Local development](local-development.md)

Remaining work before Guardrail is production-ready:

## Deployment And Naming

- build the backend image from `apps/backend/Dockerfile`
- deploy the official backend on `https://api.guardlabs.ai`
- deploy the official frontend on `https://guardlabs.ai`, paired with the official backend

## Chain Support

- set the production Base Mainnet RPC and bundler URLs

## Production Infrastructure

- provision the production Postgres instance
- verify the backend container can run the checked-in Drizzle migration automatically at startup against the production database
- set the final production environment variables for backend URL, frontend URL, RPC, bundler, and passkey server
- configure backend CORS to the real production frontend origin
- put the backend behind Cloudflare with the intended rate limiting and edge protection

## Later

- CI/CD automation
- broader observability and cleanup jobs
