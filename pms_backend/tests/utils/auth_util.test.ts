import sinon from 'sinon';
import { expect } from 'chai';
import { authorize, hasPermission } from '../../src/utils/auth_util';
import { fakeUser, makeToken, stubAuth } from '../helpers/auth';
import { UsersUtil } from '../../src/components/users/users_controller';

const mockRes = () => {
    const res: any = { statusCode: 0, body: undefined };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: any) => { res.body = body; return res; };
    return res;
};

describe('Pruebas unitarias: auth_util', () => {
    afterEach(() => sinon.restore());

    describe('hasPermission', () => {
        it('retorna true cuando el derecho está en la lista', () => {
            expect(hasPermission(['add_user', 'edit_user'], 'edit_user')).to.be.true;
        });

        it('retorna false cuando falta el derecho o la lista no existe', () => {
            expect(hasPermission(['add_user'], 'delete_user')).to.be.false;
            expect(hasPermission(undefined, 'add_user')).to.be.false;
        });
    });

    describe('authorize', () => {
        it('responde 401 si falta el encabezado Authorization', async () => {
            const res = mockRes();
            const next = sinon.spy();
            await authorize({ headers: {} } as any, res, next);
            expect(res.statusCode).to.equal(401);
            expect(next.called).to.be.false;
        });

        it('responde 401 si el token tiene firma inválida', async () => {
            const res = mockRes();
            await authorize({ headers: { authorization: `Bearer ${makeToken()}x` } } as any, res, sinon.spy());
            expect(res.statusCode).to.equal(401);
        });

        it('rechaza un refresh token usado como access token', async () => {
            const res = mockRes();
            const next = sinon.spy();
            await authorize({ headers: { authorization: `Bearer ${makeToken('refresh')}` } } as any, res, next);
            expect(res.statusCode).to.equal(401);
            expect(next.called).to.be.false;
        });

        it('rechaza un token de recuperación sin username (no debe resolver al primer usuario)', async () => {
            const lookup = sinon.stub(UsersUtil, 'getUserFromUsername').resolves(fakeUser as any);
            const token = makeToken('reset', { username: undefined });
            const res = mockRes();
            await authorize({ headers: { authorization: `Bearer ${token}` } } as any, res, sinon.spy());
            expect(res.statusCode).to.equal(401);
            expect(lookup.called).to.be.false;
        });

        it('inyecta req.user con los derechos del rol y llama a next', async () => {
            const token = stubAuth(['get_all_users']);
            const req: any = { headers: { authorization: `Bearer ${token}` } };
            const next = sinon.spy();
            await authorize(req, mockRes(), next);
            expect(next.calledOnce).to.be.true;
            expect(req.user).to.deep.include({ username: 'tester', rights: ['get_all_users'] });
        });
    });
});
