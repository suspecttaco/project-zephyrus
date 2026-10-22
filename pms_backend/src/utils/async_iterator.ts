export interface BatchResponse<T> {
    items: T[];
    nextPage: number | null;
}

export async function* fetchInBatches<T>(
    fetcher: (page: number) => Promise<BatchResponse<T>>
): AsyncGenerator<T[], void, unknown> {
    let page: number | null = 1;
    while (page !== null) {
        const response: BatchResponse<T> = await fetcher(page);
        if (response.items.length > 0) {
            yield response.items;
        }
        page = response.nextPage;
    }
}

export function pagedFetcher<T>(query: (skip: number, take: number) => Promise<T[]>, pageSize = 100) {
    return async (page: number): Promise<BatchResponse<T>> => {
        const items = await query((page - 1) * pageSize, pageSize);
        return { items, nextPage: items.length === pageSize ? page + 1 : null };
    };
}
