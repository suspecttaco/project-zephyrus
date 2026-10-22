import { expect } from 'chai';
import { MAX_SAMPLES, mulberry32, simulate, SimulationCancelled } from '../../src/utils/risk_simulation';

describe('Simulación Monte Carlo del plazo (cómputo intensivo para la CPU)', () => {
    it('es reproducible con la misma semilla y distinta con otra', () => {
        const input = { assigneeLoads: [[8, 16], [24]], samples: 20_000, seed: 7 };
        expect(simulate(input)).to.deep.equal(simulate(input));
        expect(simulate({ ...input, seed: 8 })).to.not.deep.equal(simulate(input));
    });

    it('los percentiles son crecientes', () => {
        const r = simulate({ assigneeLoads: [[10, 20, 30]], samples: 50_000, seed: 1 });
        expect(r.p50).to.be.at.most(r.p80);
        expect(r.p80).to.be.at.most(r.p90);
        expect(r.p90).to.be.at.most(r.p95);
        expect(r.mean).to.be.greaterThan(60);
    });

    it('la media converge a la esperada por la distribución triangular (1,2 por lo estimado)', () => {
        const r = simulate({ assigneeLoads: [[10]], samples: 300_000, seed: 3 });
        expect(r.mean).to.be.closeTo(12, 0.1);
    });

    it('el proyecto termina cuando termina la persona con más trabajo', () => {
        const solo = simulate({ assigneeLoads: [[40]], samples: 50_000, seed: 5 });
        const dos = simulate({ assigneeLoads: [[40], [40]], samples: 50_000, seed: 5 });
        expect(dos.mean, 'el máximo de dos variables es mayor que una sola').to.be.greaterThan(solo.mean);
        const repartido = simulate({ assigneeLoads: [[20], [20]], samples: 50_000, seed: 5 });
        expect(repartido.mean, 'repartir el trabajo acorta el plazo').to.be.lessThan(solo.mean);
    });

    it('la probabilidad de cumplir el plazo va de 0 a 1 según las horas disponibles', () => {
        const base = { assigneeLoads: [[10]], samples: 20_000, seed: 2 };
        expect(simulate({ ...base, deadlineHours: 1000 }).onTimeProbability).to.equal(1);
        expect(simulate({ ...base, deadlineHours: 1 }).onTimeProbability).to.equal(0);
        const mid = simulate({ ...base, deadlineHours: 12 }).onTimeProbability!;
        expect(mid).to.be.within(0.4, 0.7);
        expect(simulate(base).onTimeProbability).to.equal(null);
    });

    it('se puede cancelar a mitad del cálculo (cancelación cooperativa)', () => {
        let calls = 0;
        expect(() => simulate({ assigneeLoads: [[10]], samples: 1_000_000 }, () => ++calls > 3)).to.throw(SimulationCancelled);
        expect(calls).to.be.lessThan(10);
    });

    it('valida la entrada', () => {
        const ok = { assigneeLoads: [[1]], samples: 10 };
        expect(() => simulate({ ...ok, samples: 0 })).to.throw(RangeError);
        expect(() => simulate({ ...ok, samples: MAX_SAMPLES + 1 })).to.throw(RangeError);
        expect(() => simulate({ ...ok, assigneeLoads: [] })).to.throw(RangeError);
        expect(() => simulate({ ...ok, assigneeLoads: [[]] })).to.throw(RangeError);
        expect(() => simulate({ ...ok, assigneeLoads: [[-5]] })).to.throw(RangeError);
        expect(() => simulate({ ...ok, assigneeLoads: [[NaN]] })).to.throw(RangeError);
    });

    it('el generador con semilla produce valores en [0, 1) y es determinista', () => {
        const a = mulberry32(42);
        const b = mulberry32(42);
        for (let i = 0; i < 1000; i++) {
            const v = a();
            expect(v).to.be.within(0, 0.9999999999);
            expect(v).to.equal(b());
        }
    });
});
