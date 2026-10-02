import type { Movement } from "../entities/movement.js";

export interface IMovementRepository {
    findByAccount(accountId: string): Promise<Movement[]>;
    save(movement: Movement): Promise<void>;
}
