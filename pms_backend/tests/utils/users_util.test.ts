import * as jwt from 'jsonwebtoken';
import { expect } from 'chai';
import { UsersUtil } from '../../src/components/users/users_controller';
import { SERVER_CONST } from '../../src/utils/common';
import { fakeUser } from '../helpers/auth';

describe('Pruebas unitarias: UsersUtil', () => {
    it('signToken genera un JWT con el tipo de token y los datos del usuario', () => {
        const token = UsersUtil.signToken(fakeUser as any, 'refresh', 60);
        expect(token.split('.')).to.have.lengthOf(3);
        const decoded: any = jwt.verify(token, SERVER_CONST.JWTSECRET);
        expect(decoded).to.include({ username: 'tester', token_type: 'refresh', user_id: fakeUser.user_id });
    });

    it('signToken respeta el tiempo de expiración', () => {
        const decoded: any = jwt.verify(UsersUtil.signToken(fakeUser as any, 'access', 120), SERVER_CONST.JWTSECRET);
        expect(decoded.exp - decoded.iat).to.equal(120);
    });

    it('rechaza un token con firma alterada', () => {
        const token = UsersUtil.signToken(fakeUser as any, 'access', 60);
        expect(() => jwt.verify(token + 'invalid', SERVER_CONST.JWTSECRET)).to.throw();
    });

    it('getUserFromUsername y getUserByEmail retornan null con valores vacíos sin consultar la base', async () => {
        expect(await UsersUtil.getUserFromUsername(undefined as any)).to.equal(null);
        expect(await UsersUtil.getUserByEmail('')).to.equal(null);
    });
});
