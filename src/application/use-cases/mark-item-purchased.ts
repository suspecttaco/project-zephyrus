import { NotFoundError } from "../../domain/errors.js";
import type { IShoppingListRepository } from "../../domain/repositories/shopping-list-repository.js";

export class MarkItemPurchased {
    constructor(private readonly shoppingListRepository: IShoppingListRepository) {}

    async execute(input: { itemId: string; userId: string }): Promise<void> {
        const item = await this.shoppingListRepository.findItem(input.itemId);
        if (!item) throw new NotFoundError("item not found");

        item.markPurchased(input.userId);
        await this.shoppingListRepository.saveItem(item);
    }
}
