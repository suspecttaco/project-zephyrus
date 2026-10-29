import type { Group } from "../entities/group.js";

export interface IGroupRepository {
    findById(id: string): Promise<Group | null>;
    findByUser(userId: string): Promise<Group[]>;
    save(group: Group): Promise<void>;
}
