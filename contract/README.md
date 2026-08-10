# API contract

Generated files. Do not edit by hand.

- `api-contract.json` — the shape of every `/api/*` response, mirroring
  `frontend/src/types.ts`.
- `responses/*.json` — what the backend actually returned for those endpoints,
  produced by replaying recorded InventDB payloads through the real Flask app.

Both are written by `backend/tests/contract/test_contract.py` and read by
`frontend/e2e/contract.spec.ts`, so the backend and the frontend's E2E mock are
held to one agreement instead of two independent guesses.

Regenerate after changing a response shape:

```bash
cd backend && UPDATE_CONTRACT=1 python -m pytest tests/contract
cd ../frontend && npx playwright test contract.spec.ts
```

Full explanation in [`backend/tests/README.md`](../backend/tests/README.md).
