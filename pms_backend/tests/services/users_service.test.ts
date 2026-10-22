import sinon from 'sinon';
import { expect } from 'chai';
import { DatabaseUtil } from '../../src/utils/db';
import { UserService } from '../../src/components/users/users_service';

describe('Pruebas unitarias: UserService (roles ManyToMany)', () => {
    afterEach(() => sinon.restore());

    it('convierte los UUID de role_ids en objetos de rol antes de persistir', async () => {
        const create = sinon.stub().callsFake((data: any) => data);
        const save = sinon.stub().callsFake(async (entity: any) => ({ user_id: 'u1', ...entity }));
        sinon.stub(DatabaseUtil.prototype, 'getRepository').returns({ create, save } as any);

        const result = await new UserService().create({ username: 'ana', role_ids: ['r1', 'r2'] });

        expect(create.firstCall.args[0].role_ids).to.deep.equal([{ role_id: 'r1' }, { role_id: 'r2' }]);
        expect(result.statusCode).to.equal(201);
    });

    it('responde con role_ids como arreglo de UUID', async () => {
        const repo = { create: (d: any) => d, save: async (e: any) => ({ user_id: 'u1', ...e }) };
        sinon.stub(DatabaseUtil.prototype, 'getRepository').returns(repo as any);

        const result = await new UserService().create({ username: 'ana', role_ids: ['r1'] });

        expect((result.data as any).role_ids).to.deep.equal(['r1']);
    });

    it('lee los usuarios cargando los ids de sus roles', async () => {
        const find = sinon.stub().resolves([]);
        sinon.stub(DatabaseUtil.prototype, 'getRepository').returns({ find } as any);

        await new UserService().findAll({ username: 'ana' });

        expect(find.firstCall.args[0]).to.deep.include({ loadRelationIds: true });
    });

    it('no toca role_ids cuando la actualización no lo incluye', async () => {
        const existing: any = { user_id: 'u1', fullname: 'Ana' };
        const repo = {
            findOne: sinon.stub().resolves(existing),
            merge: sinon.stub().callsFake((target: any, data: any) => Object.assign(target, data)),
            save: sinon.stub().callsFake(async (e: any) => e)
        };
        sinon.stub(DatabaseUtil.prototype, 'getRepository').returns(repo as any);

        await new UserService().update('u1', { fullname: 'Ana María' });

        expect(repo.merge.firstCall.args[1]).to.deep.equal({ fullname: 'Ana María' });
    });
});
