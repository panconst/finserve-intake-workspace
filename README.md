# FinServe Intake Workspace

Working prototype for intake normalization and validation in the lead-to-application workflow.

## Overview

The workspace accepts raw intake text, extracts a structured application record, supports analyst review, and produces three downstream views from the approved record:

- CRM-style record
- draft memo summary
- API payload preview for handoff

## Run

Requirements:

- Node 18+

Start the app:

```bash
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

If no provider key is configured, the backend uses the local fallback extractor.

## Live AI mode

The server reads configuration from a local `.env` file in the project root.

1. Copy `.env.example` to `.env`
2. Add your provider credentials
3. Run `npm start`

Credentials can be supplied separately on request if needed.

## Notes

- `.env` is local and should not be committed.
- Hidden sample inputs are available for development:
  - `http://127.0.0.1:3000/?sample=clean`
  - `http://127.0.0.1:3000/?sample=missing`
  - `http://127.0.0.1:3000/?sample=conflict`
