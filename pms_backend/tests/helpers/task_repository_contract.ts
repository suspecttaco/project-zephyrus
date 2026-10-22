import { expect } from 'chai';
import { Task } from '../../src/domain/entities/task';
import { ITaskRepository } from '../../src/domain/repositories/task_repository';

export function taskRepositoryContract(
    name: string,
    setup: () => Promise<{ repo: ITaskRepository; projectId: string; otherProjectId: string; userId: string; uniqueName: () => string }>
) {
    describe(`Contrato ITaskRepository (LSP): ${name}`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        before(async () => { ctx = await setup(); });

        const build = (extra: object = {}) => new Task({ name: ctx.uniqueName(), projectId: ctx.projectId, assignedUserId: ctx.userId, ...extra });

        it('save asigna un id y marcas de tiempo, y devuelve la tarea guardada', async () => {
            const saved = await ctx.repo.save(build({ description: 'detalle' }));
            expect(saved.id).to.be.a('string').and.not.empty;
            expect(saved.createdAt).to.be.instanceOf(Date);
            expect(saved.description).to.equal('detalle');
            expect(saved.status).to.equal('Not-Started');
            expect(saved.priority).to.equal('Medium');
        });

        it('findById devuelve la misma tarea y null cuando no existe', async () => {
            const saved = await ctx.repo.save(build({ priority: 'High' }));
            const found = await ctx.repo.findById(saved.id!);
            expect(found).to.not.equal(null);
            expect(found!.toProps()).to.deep.include({ id: saved.id, name: saved.name, projectId: ctx.projectId, assignedUserId: ctx.userId, priority: 'High' });
            expect(await ctx.repo.findById('00000000-0000-4000-8000-000000000000')).to.equal(null);
        });

        it('findByProjectId devuelve solo las tareas de ese proyecto', async () => {
            const a = await ctx.repo.save(build());
            const b = await ctx.repo.save(build());
            const other = await ctx.repo.save(new Task({ name: ctx.uniqueName(), projectId: ctx.otherProjectId, assignedUserId: ctx.userId }));

            const ids = (await ctx.repo.findByProjectId(ctx.projectId)).map((t) => t.id);
            expect(ids).to.include.members([a.id, b.id]);
            expect(ids).to.not.include(other.id);
            expect(await ctx.repo.findByProjectId('00000000-0000-4000-8000-000000000000')).to.deep.equal([]);
        });

        it('conserva las fechas estimadas', async () => {
            const saved = await ctx.repo.save(build({ estimatedStartTime: new Date('2026-11-01T08:00:00Z'), estimatedEndTime: new Date('2026-11-01T16:00:00Z') }));
            const found = (await ctx.repo.findById(saved.id!))!;
            expect(found.estimatedHours()).to.equal(8);
        });
    });
}
