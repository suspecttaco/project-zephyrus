// Helpers compartidos para la suite de tests (CRUD de cuentas y movimientos
// sobre HTTP real, aislamiento en memoria y cancelación MSI). No es un test:
// no matchea el glob `tests/*.test.ts`.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { Express } from "express";
import { createApp } from "../src/presentation/app.js";
import { createMemoryRepositories } from "../src/infrastructure/memory/index.js";
import type { AppDependencies } from "../src/presentation/app.js";

export { createMemoryRepositories };
import { DEMO_FIXTURE_USER_ID } from "../src/application/request-context.js";
import { Account } from "../src/domain/entities/account.js";
import { InstallmentPurchase } from "../src/domain/entities/installment-purchase.js";
import type { AccountType } from "../src/domain/enums.js";
import { InMemoryAccountRepository } from "../src/infrastructure/memory/in-memory-account-repository.js";
import type { Account as AccountEntity } from "../src/domain/entities/account.js";
import type { IAccountRepository } from "../src/domain/repositories/account-repository.js";
import type { SnapshotCapable } from "../src/infrastructure/memory/memory-store.js";

export { DEMO_FIXTURE_USER_ID };

export type MemoryRepositories = ReturnType<typeof createMemoryRepositories>;

export interface TestApp {
    app: Express;
    baseURL: string;
    repos: MemoryRepositories;
    close: () => Promise<void>;
}

async function listen(app: Express): Promise<{ server: Server; port: number }> {
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
        server.once("listening", () => {
            resolve();
        });
        server.once("error", reject);
    });
    const address = server.address();
    if (typeof address !== "object" || address === null) {
        throw new Error("failed to bind test server");
    }
    return { server, port: address.port };
}

// Levanta una app Express con los repositorios indicados en un puerto
// efímero (HTTP real: middlewares, serialización, errores).
export async function startTestAppWith(
    repos: MemoryRepositories,
    overrides?: Partial<AppDependencies>,
): Promise<TestApp> {
    const app = createApp({ ...repos, ...overrides });
    const { server, port } = await listen(app);
    return {
        app,
        baseURL: `http://127.0.0.1:${String(port)}`,
        repos,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            }),
    };
}

// Atajo con repositorios nuevos y aislados.
export async function startTestApp(overrides?: Partial<AppDependencies>): Promise<TestApp> {
    return startTestAppWith(createMemoryRepositories(), overrides);
}

// fetch tipa Response.json() como Promise<unknown>; esta lectura devuelve
// un objeto plano para las aserciones sin casts inline.
export async function readJson(response: Response): Promise<Record<string, unknown>> {
    return (await response.json()) as Record<string, unknown>;
}

// Repositorio de cuentas whose findById siempre falla: para provocar un
// 500 genérico y comprobar que la respuesta no expone el error.
export class ExplodingAccountRepository extends InMemoryAccountRepository {
    override findById(_id: string): Promise<AccountEntity | null> {
        throw new Error("secret database password: hunter2");
    }
}

// Decorador de repositorio de cuentas que falla al guardar una cuenta
// específica: simula un fallo a mitad de una operación (p. ej. el save
// de la destino en una transferencia). Delega el resto y soporta
// snapshot/rollback para la unidad de cambios.
export class FailOnAccountSaveRepository implements IAccountRepository, SnapshotCapable {
    constructor(
        private readonly inner: InMemoryAccountRepository,
        private readonly failOnId: string,
    ) {}

    findById(id: string): Promise<AccountEntity | null> {
        return this.inner.findById(id);
    }

    findByUser(userId: string): Promise<AccountEntity[]> {
        return this.inner.findByUser(userId);
    }

    async save(account: AccountEntity): Promise<void> {
        if (account.id === this.failOnId) {
            throw new Error("injected failure on account save");
        }
        return this.inner.save(account);
    }

    delete(id: string): Promise<void> {
        return this.inner.delete(id);
    }

    snapshot(): void {
        this.inner.snapshot();
    }

    rollback(): void {
        this.inner.rollback();
    }
}

export interface SeedAccountProps {
    userId?: string;
    name: string;
    type: AccountType;
    creditLimitInCents?: number;
    cutOffDay?: number;
}

// Crea una cuenta directamente en el repositorio (sin HTTP), con el
// dueño acordado por defecto. Sirve para fixtures y cuentas ajenas.
export async function seedAccount(repos: MemoryRepositories, props: SeedAccountProps): Promise<AccountEntity> {
    const account = Account.create({
        id: randomUUID(),
        userId: props.userId ?? DEMO_FIXTURE_USER_ID,
        name: props.name,
        type: props.type,
        creditLimitInCents: props.creditLimitInCents,
        cutOffDay: props.cutOffDay,
    });
    await repos.accountRepository.save(account);
    return account;
}

export interface SeedInstallmentPurchaseProps {
    accountId: string;
    description: string;
    totalAmountInCents: number;
    totalInstallments: number;
    monthlyPaymentInCents: number;
}

// Crea una compra a MSI directamente en el repositorio (sin HTTP).
export async function seedInstallmentPurchase(
    repos: MemoryRepositories,
    props: SeedInstallmentPurchaseProps,
): Promise<InstallmentPurchase> {
    const purchase = InstallmentPurchase.create({
        id: randomUUID(),
        accountId: props.accountId,
        description: props.description,
        totalAmountInCents: props.totalAmountInCents,
        totalInstallments: props.totalInstallments,
        monthlyPaymentInCents: props.monthlyPaymentInCents,
    });
    await repos.installmentPurchaseRepository.save(purchase);
    return purchase;
}
