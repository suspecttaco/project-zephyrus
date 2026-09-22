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

## Project status

This README will be expanded every week (full stack, architecture, testing guide, and public
URLs).