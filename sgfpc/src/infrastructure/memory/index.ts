import { InMemoryAccountRepository } from "./in-memory-account-repository.js";
import { InMemoryInstallmentPurchaseRepository } from "./in-memory-installment-purchase-repository.js";
import { InMemoryMovementRepository } from "./in-memory-movement-repository.js";
import { MemoryUnitOfWork } from "./memory-unit-of-work.js";

export function createMemoryRepositories() {
    const accountRepository = new InMemoryAccountRepository();
    const movementRepository = new InMemoryMovementRepository();
    const installmentPurchaseRepository = new InMemoryInstallmentPurchaseRepository();

    const unitOfWork = new MemoryUnitOfWork([accountRepository, movementRepository, installmentPurchaseRepository]);

    return {
        accountRepository,
        movementRepository,
        installmentPurchaseRepository,
        unitOfWork,
    };
}
