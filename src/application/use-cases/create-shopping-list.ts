import { randomUUID } from "node:crypto";
import { ShoppingList } from "../../domain/entities/shopping-list.js";
import type { IShoppingListRepository } from "../../domain/repositories/shopping-list-repository.js";

export class CreateShoppingList {
    constructor(private readonly shoppingListRepository: IShoppingListRepository) {}

    async execute(input: {
        groupId: string;
        name: string;
        createdBy: string;
    }): Promise<ShoppingList> {
        const list = ShoppingList.create({
            id: randomUUID(),
            ...input,
        });
        await this.shoppingListRepository.save(list);
        return list;
    }
}
