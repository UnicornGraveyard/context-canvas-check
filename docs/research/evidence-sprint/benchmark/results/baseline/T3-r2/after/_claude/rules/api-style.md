---
paths:
  - "src/**/*.ts"
---

# API style

- Handlers validate input with Zod before they touch the database.
- Errors are returned as `{ error: { code, message } }`.
- Never log request bodies.
