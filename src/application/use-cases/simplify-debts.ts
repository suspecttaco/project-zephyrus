export interface PersonNet {
    userId: string;
    net: number; // centavos; positivo = le deben, negativo = debe
}

export interface SimplifiedPayment {
    debtorId: string;
    creditorId: string;
    amountInCents: number;
}

export function simplifyDebts(nets: PersonNet[]): SimplifiedPayment[] {
    const creditors = nets.filter((n) => n.net > 0).map((n) => ({ ...n })).sort((a, b) => b.net - a.net);
    const debtors = nets.filter((n) => n.net < 0).map((n) => ({ ...n, net: -n.net })).sort((a, b) => b.net - a.net);

    const payments: SimplifiedPayment[] = [];
    let i = 0;
    let j = 0;

    while (i < debtors.length && j < creditors.length) {
        const amount = Math.min(debtors[i].net, creditors[j].net);
        if (amount > 0) {
            payments.push({ debtorId: debtors[i].userId, creditorId: creditors[j].userId, amountInCents: amount });
        }
        debtors[i].net -= amount;
        creditors[j].net -= amount;
        if (debtors[i].net === 0) i++;
        if (creditors[j].net === 0) j++;
    }

    return payments;
}