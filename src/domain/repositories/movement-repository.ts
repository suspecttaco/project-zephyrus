import type { Movement } from "../entities/movement.js";

export interface IMovementRepository {
    findById(id: string): Promise<Movement | null>;
    findByAccount(accountId: string): Promise<Movement[]>;
    save(movement: Movement): Promise<void>;
    delete(id: string): Promise<void>;
}
