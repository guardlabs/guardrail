# Production Readiness

[Docs index](README.md) | [Quickstart](quickstart.md) | [Local development](local-development.md)

Remaining work before Conduit Wallet is production-ready:

## Deployment And Naming

- publish the CLI package to npm as `@conduit-wallet/cli`
- deploy the official backend on its real production domain
- deploy the official frontend on its real production domain, paired with the official backend
- replace placeholder hosted URLs in the README, docs, and homepage

## Chain Support

- set the production Base Mainnet RPC and bundler URLs

## Production Infrastructure

- provision the production Postgres instance
- run the checked-in Drizzle baseline migration in production
- set the final production environment variables for backend URL, frontend URL, RPC, bundler, and passkey server
- configure backend CORS to the real production frontend origin
- put the backend behind Cloudflare with the intended rate limiting and edge protection

## Later

- CI/CD automation
- broader observability and cleanup jobs
