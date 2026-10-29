import type { ShoppingList, ShoppingListItem } from "../entities/shopping-list.js";

export interface IShoppingListRepository {
    findById(id: string): Promise<ShoppingList | null>;
    findByGroup(groupId: string): Promise<ShoppingList[]>;
    save(list: ShoppingList): Promise<void>;
    findItem(itemId: string): Promise<ShoppingListItem | null>;
    saveItem(item: ShoppingListItem): Promise<void>;
    removeItem(itemId: string): Promise<void>;
}
