# intellect-api

Backend for **Intellect**, a research-portfolio management app. The Angular frontend lives in [`scaling-doodle`](https://github.com/adamstavely/scaling-doodle).

## Stack

- **NestJS** (TypeScript)
- **Elastic** as the only datastore. Production uses Elastic Cloud; local dev runs Elasticsearch locally.
- Paper impact metrics (downloads, views, citations, altmetric, mentions) come from an internal metrics API.
- Auth is stubbed for now with a Chief/PI role switch; real auth comes later.

## Deployment

- **Dev:** everything runs locally.
- **Prod:** EKS + Elastic Cloud.
