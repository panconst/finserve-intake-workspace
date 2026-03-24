# FinServe Intake Workspace

Working prototype for the Step 2 intake-validation slice.

## Overview

This prototype focuses on one narrow part of the lead-to-application workflow:

- accept fresh intake text
- extract a structured application record
- surface review reasons and source evidence
- let an operations user confirm or correct fields
- create one approved record
- reuse that approved record in downstream outputs

Downstream outputs in this prototype are:

- CRM-style record view
- draft memo summary
- API payload preview for handoff into the next system step

## Reviewer setup

Requirements:

- Node 18+ recommended

Run locally:

```bash
npm start
```

Then open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Default behavior

The project works without any API key.

If no provider key is configured, the backend uses a local extraction fallback so the reviewer can still evaluate the workflow end-to-end without setting up secrets.

This fallback mode is intended to make the prototype reproducible and easy to run in a clean environment. It demonstrates the intake-review-approval workflow without requiring external credentials.

## Optional live AI mode

The server reads a local `.env` file from the project root.

1. Copy `.env.example` to `.env`
2. Fill in your local provider key
3. Run `npm start`

Example `.env` for OpenRouter:

```env
OPENROUTER_API_KEY=your-openrouter-key
OPENROUTER_MODEL=openai/gpt-4o-mini
```

Example `.env` for OpenAI:

```env
OPENAI_API_KEY=your-openai-key
OPENAI_MODEL=gpt-4o-mini
```

The `.env` file is local only and should not be committed.

With provider credentials configured, the prototype uses live AI extraction through the backend and produces a more complete and realistic extraction flow than the local fallback mode.

For a full live verification of the prototype, provider credentials can be supplied separately on request rather than embedded in the public repository.

## Notes

- The fallback path is included intentionally so the prototype remains reproducible for reviewers.
- Live AI mode is available through backend environment configuration, not through a frontend API key field.
- The main UI does not expose demo cases, but for development you can preload hidden samples:
  - `http://127.0.0.1:3000/?sample=clean`
  - `http://127.0.0.1:3000/?sample=missing`
  - `http://127.0.0.1:3000/?sample=conflict`
