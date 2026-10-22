import sinon from 'sinon';
import { expect } from 'chai';
import { BaseService } from '../../src/utils/base_service';

const buildService = (repo: any) => new BaseService<any>(repo, 'item_id');

describe('Pruebas unitarias: BaseService', () => {
    it('create retorna 201 con el registro guardado', async () => {
        const repo = { create: sinon.stub().returns({ name: 'a' }), save: sinon.stub().resolves({ item_id: '1', name: 'a' }) };
        const result = await buildService(repo).create({ name: 'a' });
        expect(result).to.deep.include({ statusCode: 201, status: 'success' });
        expect(result.data).to.deep.equal({ item_id: '1', name: 'a' });
    });

    const cases: [string, any, number][] = [
        ['clave duplicada (23505)', { code: '23505', detail: 'ya existe' }, 409],
        ['integridad referencial (23503)', { code: '23503' }, 409],
        ['UUID inválido (22P02)', { code: '22P02' }, 400],
        ['valor demasiado largo (22001)', { code: '22001' }, 400],
        ['error desconocido', new Error('boom'), 500]
    ];
    cases.forEach(([name, error, expected]) => {
        it(`create mapea ${name} a ${expected}`, async () => {
            const repo = { create: sinon.stub().returns({}), save: sinon.stub().rejects(error) };
            const result = await buildService(repo).create({});
            expect(result.statusCode).to.equal(expected);
            expect(result.status).to.equal('error');
        });
    });

    it('findOne retorna 404 si no existe y filtra por la clave primaria configurada', async () => {
        const findOne = sinon.stub().resolves(null);
        const result = await buildService({ findOne }).findOne('abc');
        expect(result.statusCode).to.equal(404);
        expect(findOne.firstCall.args[0]).to.deep.equal({ where: { item_id: 'abc' } });
    });

    it('update mapea un conflicto de unicidad a 409', async () => {
        const repo = {
            findOne: sinon.stub().resolves({ item_id: '1' }),
            merge: sinon.stub(),
            save: sinon.stub().rejects({ code: '23505' })
        };
        expect((await buildService(repo).update('1', {})).statusCode).to.equal(409);
    });

    it('delete retorna 404 cuando no se afectó ninguna fila y 200 cuando sí', async () => {
        expect((await buildService({ delete: sinon.stub().resolves({ affected: 0 }) }).delete('1')).statusCode).to.equal(404);
        expect((await buildService({ delete: sinon.stub().resolves({ affected: 1 }) }).delete('1')).statusCode).to.equal(200);
    });

    describe('campos escribibles (writableFields)', () => {
        class Restricted extends BaseService<any> {
            constructor(repo: any) {
                super(repo, 'item_id');
                this.writableFields = ['name'];
            }
        }

        it('create ignora la clave primaria y los campos no permitidos', async () => {
            const create = sinon.stub().callsFake((d: any) => d);
            const service = new Restricted({ create, save: sinon.stub().resolves({}) });
            await service.create({ name: 'a', item_id: 'inyectado', created_at: 'ayer' });
            expect(create.firstCall.args[0]).to.deep.equal({ name: 'a' });
        });

        it('update no puede cambiar la clave primaria (evita crear un registro nuevo)', async () => {
            const merge = sinon.stub();
            const service = new Restricted({ findOne: sinon.stub().resolves({ item_id: '1' }), merge, save: sinon.stub().resolves({}) });
            await service.update('1', { name: 'b', item_id: 'otro' });
            expect(merge.firstCall.args[1]).to.deep.equal({ name: 'b' });
        });
    });
});
