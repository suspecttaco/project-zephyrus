# Project Zephyrus

Backend for personal and shared finances aimed at families and roommates: tracks credit/debit
card and cash expenses, installment purchases, debts between people, and card cut-off date
reminders — replacing the manual spreadsheet.

## Running the server

Requirements: Node.js >= 20.

```bash
npm install
cp .env.example .env
npm run dev
```

Check it's alive:

```bash
curl http://localhost:3000/api/health
# {"status":"ok"}
```

## Architecture

Clean Architecture with 4 layers:

```
src/
├── domain/            # Entities, value objects, enums, errors, repository interfaces
├── application/       # Use cases with dependency injection
├── infrastructure/    # (pending) TypeORM, Redis, logger, Argon2, JWT, WebSockets
└── presentation/      # (pending) Express routers, controllers, middlewares, Zod, Swagger
```

### Domain layer

- **Entities:** User, Account, Movement, Group, SharedExpense, GroupMembership,
  InstallmentPurchase, Loan, ShoppingList, Budget, Investment
- **Value objects:** Money (integer cents), Email
- **Enums:** AccountType, MovementType, GroupRole, MovementCategory, LoanStatus,
  ShoppingListStatus, InvestmentStatus
- **Errors:** DomainError hierarchy (NegativeBalanceError, CreditLimitExceededError, etc.)
- **Repository interfaces:** 10 abstract ports (IUserRepository, IAccountRepository, etc.)

### Application layer (24 use cases)

- **Auth:** RegisterUser, LoginUser
- **Accounts:** CreateAccount, RegisterMovement, GetAccountSummary
- **Groups:** CreateGroup, AddMemberToGroup, RemoveMemberFromGroup, UpdateGroup,
  CreateSharedExpense, CalculateGroupBalance, GetGroupLedger
- **Debt simplification:** SimplifyDebts
- **Guards:** requireGroupAdmin (only group admins edit the group, remove members or create investments)
- **Installments:** CreateInstallmentPurchase, PayInstallment, AdvanceInstallments
- **Loans:** RegisterLoan, LiquidateLoan
- **Shopping lists:** CreateShoppingList, MarkItemPurchased
- **Budgets:** CreateBudget
- **Investments:** CreateInvestment, RegisterContribution
- **Reports:** GenerateMonthlyReport
- **Debt simplification:** SimplifyDebts

## Scripts

| Command             | Description                            |
| ------------------- | -------------------------------------- |
| `npm run dev`       | Start dev server with hot reload (tsx) |
| `npm run build`     | Compile TypeScript to `dist/`          |
| `npm start`         | Run compiled server                    |
| `npm run typecheck` | Type-check without emitting            |
| `npm run cluster`   | Start with cluster mode                |
| `npm run loadtest`  | Run autocannon load test               |

## Project status

- [x] Week 1 — HTTP core (node:http, event loop, env vars)
- [x] Week 2 — Native routing (node:url, in-memory CRUD)
- [x] Week 3 — Streams, buffers, cluster, graceful shutdown
- [x] Week 4 — TypeScript strict, domain types
- [x] Week 5 — Clean Architecture, rich entities, value objects, use cases
- [ ] Week 6 — Linters, Prettier, Git hooks
- [ ] Week 7 — Express REST API
- [ ] Week 8 — Zod validation, Winston logging
- [ ] Week 9 — Swagger, HATEOAS
- [ ] Week 10 — PostgreSQL, TypeORM, Docker
- [ ] Week 11 — JWT, RBAC, Argon2id
- [ ] Week 12 — Redis caching
- [ ] Week 13 — Jest tests
- [ ] Week 14 — Docker multi-stage, CI/CD, AWS
- [ ] Week 15 — WebSockets, production-ready
