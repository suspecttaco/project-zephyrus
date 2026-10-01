import { RegisterUser } from "../src/application/use-cases/register-user.js";
import { CreateAccount } from "../src/application/use-cases/create-account.js";
import { RegisterMovement } from "../src/application/use-cases/register-movement.js";
import { CreateGroup } from "../src/application/use-cases/create-group.js";
import { AddMemberToGroup } from "../src/application/use-cases/add-member-to-group.js";
import { CreateSharedExpense } from "../src/application/use-cases/create-shared-expense.js";
import { CalculateGroupBalance } from "../src/application/use-cases/calculate-group-balance.js";
import { AccountType, MovementType } from "../src/domain/enums.js";

// testing en memoria
function inMemoryRepo<T extends { id?: string }>() {
    const store = new Map<string, T>();
    return {
        store,
        async save(entity: T & { id: string }) { store.set(entity.id, entity); },
        async findById(id: string) { return store.get(id) ?? null; },
    };
}

async function main() {
    const users = { ...inMemoryRepo<any>(), async findByEmail(email: string) {
            return [...users.store.values()].find((u: any) => u.email.toString() === email) ?? null;
        }};
    const accounts = inMemoryRepo<any>();
    const movements = { ...inMemoryRepo<any>(), async findByAccount() { return []; } };
    const groups = inMemoryRepo<any>();
    const memberships = { ...inMemoryRepo<any>(),
        async find(groupId: string, userId: string) {
            return [...memberships.store.values()].find((m: any) => m.groupId === groupId && m.userId === userId) ?? null;
        },
        async findByGroup() { return []; },
        async save(m: any) { memberships.store.set(`${m.groupId}:${m.userId}`, m); },
        async remove() {},
    };
    const sharedExpenses = { ...inMemoryRepo<any>(), async findByGroup(groupId: string) {
            return [...sharedExpenses.store.values()].filter((e: any) => e.groupId === groupId);
        }};
    const loans = { ...inMemoryRepo<any>(), async findByGroup() { return []; } };

    const ana = await new RegisterUser(users as any).execute({ email: "ana@test.com", password: "x", name: "Ana" });
    const beto = await new RegisterUser(users as any).execute({ email: "beto@test.com", password: "x", name: "Beto" });

    const account = await new CreateAccount(accounts as any).execute({
        userId: ana.id, name: "Nu", type: AccountType.CREDIT, creditLimitInCents: 5_000_00,
    });

    await new RegisterMovement(movements as any, accounts as any).execute({
        accountId: account.id, type: MovementType.EXPENSE, amountInCents: 1_200_00, description: "Cena",
    });

    const group = await new CreateGroup(groups as any, memberships as any).execute({ name: "Depa", createdBy: ana.id });
    await new AddMemberToGroup(memberships as any).execute({ groupId: group.id, userId: beto.id });

    await new CreateSharedExpense(sharedExpenses as any).execute({
        groupId: group.id, paidBy: ana.id, amountInCents: 1_000_00, description: "Renta",
        split: [
            { userId: ana.id, assignedAmountInCents: 500_00 },
            { userId: beto.id, assignedAmountInCents: 500_00 },
        ],
    });

    const balance = await new CalculateGroupBalance(sharedExpenses as any, loans as any).execute(group.id);
    console.log("Balance:", balance);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});