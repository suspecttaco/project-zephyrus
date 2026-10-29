export function buildMovementsSeed(count = 50) {
    const types = ["income", "expense", "transfer"];
    const categories = ["groceries", "rent", "transport", "utilities", "entertainment"];
    const movements = [];

    for (let i = 1; i <= count; i++) {
        movements.push({
            id: String(i),
            accountId: String((i % 5) + 1),
            type: types[i % types.length],
            amount: Math.round(Math.random() * 500000),
            category: categories[i % categories.length],
            description: `Movement #${i}`,
            date: new Date(Date.now() - i * 86_400_000).toISOString(),
        });
    }

    return movements;
}
