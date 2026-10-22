import { expect } from 'chai';
import { encryptString, bcryptCompare } from '../../src/utils/common';

describe('Pruebas unitarias: common utils', () => {
    it('debe cifrar una contraseña con bcrypt', async () => {
        const hash = await encryptString('Password123!');
        expect(hash).to.be.a('string');
        expect(hash).to.not.equal('Password123!');
    });

    it('debe comparar correctamente la contraseña con el hash', async () => {
        const hash = await encryptString('Password123!');
        const result = await bcryptCompare('Password123!', hash);
        expect(result).to.be.true;
    });

    it('debe retornar false para contraseña incorrecta', async () => {
        const hash = await encryptString('Password123!');
        const result = await bcryptCompare('WrongPassword', hash);
        expect(result).to.be.false;
    });
});
