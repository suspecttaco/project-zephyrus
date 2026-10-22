export type Context = Record<string, any>;
export type NextFn = (err?: any) => Promise<void> | void;
export type Middleware = (ctx: Context, next: NextFn) => Promise<void> | void;

export class Pipeline {
    private middlewares: Middleware[] = [];

    public use(fn: Middleware): this {
        this.middlewares.push(fn);
        return this;
    }

    public async execute(ctx: Context): Promise<void> {
        let index = -1;
        const dispatch = async (i: number): Promise<void> => {
            if (i <= index) throw new Error('next() llamado múltiples veces');
            index = i;
            if (i === this.middlewares.length) return;
            const fn = this.middlewares[i];
            await fn(ctx, async (err?: any) => {
                if (err) throw err;
                await dispatch(i + 1);
            });
        };
        await dispatch(0);
    }
}
