export interface UnitOfWork {
    run<T>(operation: () => Promise<T>): Promise<T>;
}

export const directUnitOfWork: UnitOfWork = {
    async run<T>(operation: () => Promise<T>): Promise<T> {
        return operation();
    },
};
