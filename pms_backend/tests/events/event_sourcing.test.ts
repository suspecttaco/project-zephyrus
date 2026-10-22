import sinon from 'sinon';
import { expect } from 'chai';
import { ChangeRow, deriveEvents, replay, StreamEvent, TRACKED_FIELDS } from '../../src/events/stream_events';
import { EventStore } from '../../src/events/event_store';
import { ProjectMetricsProjector } from '../../src/events/projectors';
import { sessionWindows, slidingWindows, tumblingWindows } from '../../src/events/windowing';

const P1 = 'project-1';
const P2 = 'project-2';
const row = (extra: Record<string, any> = {}) => ({
    task_id: 't1', name: 'Tarea', description: null, project_id: P1, user_id: 'u1', status: 'Not-Started', priority: 'Medium',
    estimated_start_time: null, estimated_end_time: null, actual_start_time: null, actual_end_time: null, supported_files: null,
    created_at: '2026-10-22T08:00:00Z', updated_at: '2026-10-22T08:00:00Z', ...extra
});
const change = (seq: number, op: 'I' | 'U' | 'D', oldRow: any, newRow: any, at = '2026-10-22T08:00:00Z'): ChangeRow =>
    ({ seq: String(seq), op, task_id: 't1', old_row: oldRow, new_row: newRow, changed_at: at });
const types = (events: StreamEvent[]) => events.map((e) => e.eventType);

describe('Event Sourcing: derivación de eventos de dominio desde el log de cambios (CDC)', () => {
    it('un INSERT produce TaskCreated con todo el estado inicial', () => {
        const [event, ...rest] = deriveEvents(change(1, 'I', null, row({ name: 'Diseñar' })));
        expect(rest).to.have.lengthOf(0);
        expect(event.eventType).to.equal('TaskCreated');
        expect(event.aggregateId).to.equal('t1');
        expect(Object.keys(event.payload)).to.have.members([...TRACKED_FIELDS]);
        expect(event.payload).to.include({ name: 'Diseñar', project_id: P1, status: 'Not-Started' });
    });

    it('un cambio de estado produce TaskStatusChanged y, al completar, también TaskCompleted', () => {
        expect(types(deriveEvents(change(2, 'U', row(), row({ status: 'In-Progress' }))))).to.deep.equal(['TaskStatusChanged']);
        const done = deriveEvents(change(3, 'U', row({ status: 'In-Review' }), row({ status: 'Completed' })));
        expect(types(done)).to.deep.equal(['TaskStatusChanged', 'TaskCompleted']);
        expect(done[0].payload).to.deep.equal({ oldStatus: 'In-Review', newStatus: 'Completed' });
    });

    it('reasignar, renombrar y mover producen sus propios eventos', () => {
        expect(deriveEvents(change(2, 'U', row(), row({ user_id: 'u2' })))[0]).to.deep.include({ eventType: 'TaskAssigned', payload: { from: 'u1', to: 'u2' } });
        expect(deriveEvents(change(2, 'U', row(), row({ name: 'Nuevo' })))[0]).to.deep.include({ eventType: 'TaskRenamed', payload: { from: 'Tarea', to: 'Nuevo' } });
        expect(deriveEvents(change(2, 'U', row(), row({ project_id: P2 })))[0]).to.deep.include({ eventType: 'TaskMoved', payload: { from: P1, to: P2 } });
    });

    it('los demás campos se agrupan en TaskFieldsChanged con el valor anterior y el nuevo', () => {
        const [event] = deriveEvents(change(2, 'U', row(), row({ priority: 'High', description: 'detalle' })));
        expect(event.eventType).to.equal('TaskFieldsChanged');
        expect(event.payload.changes).to.deep.equal({ description: { from: null, to: 'detalle' }, priority: { from: 'Medium', to: 'High' } });
    });

    it('un UPDATE que solo cambia updated_at no genera eventos', () => {
        expect(deriveEvents(change(2, 'U', row(), row({ updated_at: '2026-10-22T09:00:00Z' })))).to.deep.equal([]);
    });

    it('un UPDATE con varios cambios produce varios eventos con identificadores deterministas', () => {
        const events = deriveEvents(change(7, 'U', row(), row({ status: 'In-Progress', user_id: 'u2', priority: 'Low' })));
        expect(types(events)).to.deep.equal(['TaskStatusChanged', 'TaskAssigned', 'TaskFieldsChanged']);
        expect(events.map((e) => e.eventId)).to.deep.equal(['7-0', '7-1', '7-2']);
        expect(deriveEvents(change(7, 'U', row(), row({ status: 'In-Progress', user_id: 'u2', priority: 'Low' })))[0].eventId).to.equal('7-0');
    });

    it('si cambian estado y proyecto a la vez, el cambio de estado se atribuye al proyecto de origen', () => {
        const events = deriveEvents(change(2, 'U', row(), row({ status: 'In-Progress', project_id: P2 })));
        expect(events.find((e) => e.eventType === 'TaskStatusChanged')!.context.projectId).to.equal(P1);
        expect(events.find((e) => e.eventType === 'TaskMoved')!.context.projectId).to.equal(P2);
    });

    it('un DELETE produce TaskDeleted conservando el proyecto y el estado que tenía', () => {
        const [event] = deriveEvents(change(9, 'D', row({ status: 'In-Progress' }), null));
        expect(event).to.deep.include({ eventType: 'TaskDeleted', payload: { projectId: P1, status: 'In-Progress' } });
    });
});

describe('Event Sourcing: reproducción (replay) y viaje en el tiempo', () => {
    const history = (): StreamEvent[] => [
        ...deriveEvents(change(1, 'I', null, row({ name: 'Original' }), '2026-10-22T08:00:00Z')),
        ...deriveEvents(change(2, 'U', row({ name: 'Original' }), row({ name: 'Original', status: 'In-Progress' }), '2026-10-22T09:00:00Z')),
        ...deriveEvents(change(3, 'U', row({ name: 'Original', status: 'In-Progress' }), row({ name: 'Renombrada', status: 'In-Progress', user_id: 'u2' }), '2026-10-22T10:00:00Z')),
        ...deriveEvents(change(4, 'D', row({ name: 'Renombrada', status: 'In-Progress', user_id: 'u2' }), null, '2026-10-22T11:00:00Z'))
    ];

    it('el estado final sale únicamente de reproducir los eventos', () => {
        const state = replay(history())!;
        expect(state).to.include({ name: 'Renombrada', status: 'In-Progress', user_id: 'u2', deleted: true });
    });

    it('viaje en el tiempo: el estado en cada instante pasado', () => {
        const at = (iso: string) => replay(history(), new Date(iso));
        expect(at('2026-10-22T07:59:00Z')).to.equal(null);
        expect(at('2026-10-22T08:30:00Z')).to.include({ name: 'Original', status: 'Not-Started' });
        expect(at('2026-10-22T09:30:00Z')).to.include({ name: 'Original', status: 'In-Progress' });
        expect(at('2026-10-22T10:30:00Z')).to.include({ name: 'Renombrada', user_id: 'u2' });
        expect(at('2026-10-22T10:30:00Z')!.deleted).to.equal(undefined);
        expect(at('2026-10-22T11:30:00Z')!.deleted).to.equal(true);
    });

    it('los campos genéricos (prioridad, fechas, adjuntos) también se reconstruyen', () => {
        const events = [
            ...deriveEvents(change(1, 'I', null, row())),
            ...deriveEvents(change(2, 'U', row(), row({ priority: 'High', supported_files: '[{"name":"a.txt"}]' })))
        ];
        expect(replay(events)).to.include({ priority: 'High', supported_files: '[{"name":"a.txt"}]' });
    });

    it('sin eventos no hay estado', () => {
        expect(replay([])).to.equal(null);
    });
});

describe('EventStore en memoria (append-only, inmutable)', () => {
    const event = (id: string, aggregate: string): StreamEvent =>
        ({ eventId: id, eventType: 'TaskCreated', aggregateId: aggregate, timestamp: new Date(), payload: {}, context: { projectId: null, status: null, seq: '1' } });

    it('guarda los eventos por agregado y notifica a los suscriptores', () => {
        const store = new EventStore();
        const seen = sinon.spy();
        store.on('eventPublished', seen);
        store.appendEvent(event('e1', 'a'));
        store.appendEvent(event('e2', 'b'));
        store.appendEvent(event('e3', 'a'));
        expect(store.getEventStream('a').map((e) => e.eventId)).to.deep.equal(['e1', 'e3']);
        expect(seen.callCount).to.equal(3);
    });

    it('los eventos guardados no se pueden modificar', () => {
        const store = new EventStore();
        store.appendEvent(event('e1', 'a'));
        expect(Object.isFrozen(store.getEventStream('a')[0])).to.be.true;
        expect(() => { 'use strict'; (store.getEventStream('a')[0] as any).eventType = 'Otro'; }).to.throw(TypeError);
    });
});

describe('CQRS: ProjectMetricsProjector (modelo de lectura)', () => {
    const run = (changes: ChangeRow[]) => {
        const projector = new ProjectMetricsProjector();
        changes.flatMap(deriveEvents).forEach((e) => projector.handleEvent(e));
        return projector.getDeltas();
    };
    const zero = { total: 0, not_started: 0, in_progress: 0, in_review: 0, completed: 0 };

    it('crear suma al total y al estado inicial', () => {
        expect(run([change(1, 'I', null, row())]).get(P1)).to.deep.equal({ ...zero, total: 1, not_started: 1 });
    });

    it('el ciclo completo de una tarea deja una completada y ninguna en otros estados', () => {
        const d = run([
            change(1, 'I', null, row()),
            change(2, 'U', row(), row({ status: 'In-Progress' })),
            change(3, 'U', row({ status: 'In-Progress' }), row({ status: 'In-Review' })),
            change(4, 'U', row({ status: 'In-Review' }), row({ status: 'Completed' }))
        ]).get(P1);
        expect(d).to.deep.equal({ ...zero, total: 1, completed: 1 });
    });

    it('borrar resta del total y del estado que tenía', () => {
        expect(run([change(1, 'I', null, row()), change(2, 'D', row(), null)]).get(P1)).to.deep.equal(zero);
    });

    it('mover una tarea traslada el conteo de un proyecto a otro', () => {
        const deltas = run([change(1, 'I', null, row({ status: 'In-Progress' })), change(2, 'U', row({ status: 'In-Progress' }), row({ status: 'In-Progress', project_id: P2 }))]);
        expect(deltas.get(P1)).to.deep.equal(zero);
        expect(deltas.get(P2)).to.deep.equal({ ...zero, total: 1, in_progress: 1 });
    });

    it('cambiar estado y proyecto en un mismo UPDATE deja los conteos consistentes', () => {
        const deltas = run([change(1, 'I', null, row()), change(2, 'U', row(), row({ status: 'In-Progress', project_id: P2 }))]);
        expect(deltas.get(P1)).to.deep.equal(zero);
        expect(deltas.get(P2)).to.deep.equal({ ...zero, total: 1, in_progress: 1 });
    });

    it('ignora los eventos que no afectan a esta vista', () => {
        const d = run([change(1, 'I', null, row()), change(2, 'U', row(), row({ name: 'X', user_id: 'u9', priority: 'High' }))]).get(P1);
        expect(d).to.deep.equal({ ...zero, total: 1, not_started: 1 });
    });
});

describe('Ventanas de tiempo (windowing)', () => {
    const s = (seconds: number) => seconds * 1000;

    it('tumbling: ventanas disjuntas y cada evento cae en exactamente una', () => {
        const w = tumblingWindows([s(1), s(2), s(9), s(10), s(25)], s(10));
        expect(w.map((x) => [x.start / 1000, x.end / 1000, x.count])).to.deep.equal([[0, 10, 3], [10, 20, 1], [20, 30, 1]]);
        expect(w.reduce((n, x) => n + x.count, 0)).to.equal(5);
    });

    it('tumbling: sin eventos no hay ventanas', () => {
        expect(tumblingWindows([], s(10))).to.deep.equal([]);
    });

    it('sliding: las ventanas se solapan, así que un evento puede contarse en varias', () => {
        const w = slidingWindows([s(12)], s(10), s(5));
        expect(w.map((x) => [x.start / 1000, x.count])).to.deep.equal([[5, 1], [10, 1]]);
        const total = slidingWindows([s(1), s(2), s(3)], s(10), s(5)).reduce((n, x) => n + x.count, 0);
        expect(total).to.be.greaterThan(3);
    });

    it('sliding: cuenta correctamente los eventos de cada ventana', () => {
        const w = slidingWindows([s(0), s(4), s(8)], s(10), s(5));
        expect(w.find((x) => x.start === 0)!.count).to.equal(3);
        expect(w.find((x) => x.start === s(5))!.count).to.equal(1);
    });

    it('session: una brecha de inactividad mayor al umbral separa las sesiones', () => {
        const w = sessionWindows([s(1), s(2), s(3), s(60), s(61), s(200)], s(30));
        expect(w.map((x) => x.count)).to.deep.equal([3, 2, 1]);
        expect(w[0].start).to.equal(s(1));
        expect(w[1].start).to.equal(s(60));
    });

    it('session: sin brechas grandes todo es una sola sesión, aunque lleguen desordenados', () => {
        expect(sessionWindows([s(5), s(1), s(3)], s(30))).to.have.lengthOf(1);
        expect(sessionWindows([], s(30))).to.deep.equal([]);
    });
});
