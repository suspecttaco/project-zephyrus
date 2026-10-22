import { simulate, RiskInput } from '../utils/risk_simulation';

process.on('message', (input: RiskInput) => {
    try {
        process.send?.({ result: simulate(input) });
    } catch (error: any) {
        process.send?.({ error: error.message });
    }
    process.exit(0);
});
