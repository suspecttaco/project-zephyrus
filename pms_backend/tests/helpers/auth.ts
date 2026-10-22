import sinon from 'sinon';
import * as jwt from 'jsonwebtoken';
import { SERVER_CONST } from '../../src/utils/common';
import { UsersUtil } from '../../src/components/users/users_controller';
import { RoleUtil } from '../../src/components/roles/roles_controller';

export const fakeUser: any = {
    user_id: '11111111-1111-4111-8111-111111111111',
    username: 'tester',
    email: 'tester@pms.com',
    fullname: 'Usuario de Prueba',
    password: 'hash',
    role_ids: ['22222222-2222-4222-8222-222222222222']
};

export const makeToken = (type: string = 'access', payload: object = {}, expiresIn: any = '1h'): string =>
    jwt.sign({ user_id: fakeUser.user_id, username: fakeUser.username, email: fakeUser.email, token_type: type, ...payload },
        SERVER_CONST.JWTSECRET, { expiresIn });

export const stubAuth = (rights: string[]): string => {
    sinon.stub(UsersUtil, 'getUserFromUsername').resolves(fakeUser as any);
    sinon.stub(RoleUtil, 'getAllRightsFromRoles').resolves(rights);
    return makeToken('access');
};

export const ok = (data: any, statusCode: number = 200): any => ({ statusCode, status: 'success', data });
