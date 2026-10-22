import sinon from 'sinon';
import { expect } from 'chai';
import { DatabaseUtil } from '../../src/utils/db';
import { ProjectService } from '../../src/components/projects/projects_service';
import { Projects } from '../../src/components/projects/projects_entity';
import { Tasks, Priority, Status } from '../../src/components/tasks/tasks_entity';

const buildRunner = (saveStub: sinon.SinonStub) => ({
    connect: sinon.stub().resolves(),
    startTransaction: sinon.stub().resolves(),
    commitTransaction: sinon.stub().resolves(),
    rollbackTransaction: sinon.stub().resolves(),
    release: sinon.stub().resolves(),
    manager: { create: sinon.stub().callsFake((_entity: any, data: any) => data), save: saveStub }
});

describe('Pruebas unitarias: ProjectService (transacción ACID)', () => {
    afterEach(() => sinon.restore());

    it('confirma la transacción y libera la conexión cuando proyecto y tarea se guardan', async () => {
        const save = sinon.stub();
        save.onFirstCall().resolves({ project_id: 'p1', name: 'Proyecto' });
        save.onSecondCall().resolves({});
        const runner = buildRunner(save);
        sinon.stub(DatabaseUtil.prototype, 'createQueryRunner').returns(runner as any);

        const project = await new ProjectService().createProjectWithDefaultTask({ name: 'Proyecto' }, 'u1');

        expect(project).to.deep.include({ project_id: 'p1' });
        expect(runner.commitTransaction.calledOnce).to.be.true;
        expect(runner.rollbackTransaction.called).to.be.false;
        expect(runner.release.calledOnce).to.be.true;
        const taskData = runner.manager.create.secondCall.args[1];
        expect(runner.manager.create.secondCall.args[0]).to.equal(Tasks);
        expect(runner.manager.create.firstCall.args[0]).to.equal(Projects);
        expect(taskData).to.include({ project_id: 'p1', user_id: 'u1', status: Status.NotStarted, priority: Priority.High });
        expect(taskData.name.length).to.be.at.most(30);
    });

    it('revierte todo y libera la conexión si falla la tarea por defecto', async () => {
        const save = sinon.stub();
        save.onFirstCall().resolves({ project_id: 'p1' });
        save.onSecondCall().rejects(new Error('fallo al guardar la tarea'));
        const runner = buildRunner(save);
        sinon.stub(DatabaseUtil.prototype, 'createQueryRunner').returns(runner as any);

        let error: any;
        try {
            await new ProjectService().createProjectWithDefaultTask({ name: 'Proyecto' }, 'u1');
        } catch (e) {
            error = e;
        }

        expect(error).to.be.an('error').with.property('message', 'fallo al guardar la tarea');
        expect(runner.commitTransaction.called).to.be.false;
        expect(runner.rollbackTransaction.calledOnce).to.be.true;
        expect(runner.release.calledOnce).to.be.true;
    });

    it('asigna al creador como miembro cuando no se envían user_ids', async () => {
        const save = sinon.stub().resolves({ project_id: 'p1' });
        const runner = buildRunner(save);
        sinon.stub(DatabaseUtil.prototype, 'createQueryRunner').returns(runner as any);

        await new ProjectService().createProjectWithDefaultTask({ name: 'Proyecto' }, 'u1');

        expect(runner.manager.create.firstCall.args[1].user_ids).to.deep.equal(['u1']);
    });
});
