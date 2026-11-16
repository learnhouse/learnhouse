# Companies (company seats + company spaces)

Requires Enterprise Edition on the Pro plan (`company_seats`). Specs skip
themselves when the instance doesn't have the feature. Run against an EE stack:

```bash
E2E_BASE_URL=http://localhost:3000 bun run test features/companies
```
