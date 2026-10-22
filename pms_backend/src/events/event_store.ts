import { EventEmitter } from 'events';
import { DatabaseUtil } from '../utils/db';
import { TaskChanges } from './entities';
import { ChangeRow, deriveEvents, StreamEvent } from './stream_events';

export class EventStore extends EventEmitter {
    private events: StreamEvent[] = [];

    public appendEvent(event: StreamEvent): void {
        this.events.push(Object.freeze(event));
        this.emit('eventPublished', event);
    }

    public getEventStream(aggregateId: string): StreamEvent[] {
        return this.events.filter((e) => e.aggregateId === aggregateId);
    }
}

export class CdcEventStore {
    private get repo() {
        return new DatabaseUtil().getRepository(TaskChanges);
    }

    public async getEventStream(aggregateId: string, at?: Date): Promise<StreamEvent[]> {
        const qb = this.repo.createQueryBuilder('c').where('c.task_id = :id', { id: aggregateId }).orderBy('c.seq', 'ASC');
        if (at) qb.andWhere('c.changed_at <= :at', { at });
        return (await qb.getMany()).flatMap((c) => deriveEvents(c as unknown as ChangeRow));
    }

    public async hasStream(aggregateId: string): Promise<boolean> {
        return (await this.repo.count({ where: { task_id: aggregateId } })) > 0;
    }
}
