import sinon from 'sinon';
import { expect } from 'chai';
import { body } from 'express-validator';
import { validate } from '../../src/utils/validator';

const run = async (rules: any[], reqBody: any) => {
    const res: any = {};
    res.status = sinon.stub().returns(res);
    res.json = sinon.stub().returns(res);
    const next = sinon.spy();
    await validate(rules)({ body: reqBody } as any, res, next);
    return { res, next };
};

describe('Pruebas unitarias: validator', () => {
    it('exporta la función validate', () => {
        expect(validate).to.be.a('function');
    });

    it('llama a next cuando los datos son válidos', async () => {
        const { next, res } = await run([body('name').notEmpty()], { name: 'ok' });
        expect(next.calledOnce).to.be.true;
        expect(res.status.called).to.be.false;
    });

    it('responde 400 con el detalle de los errores cuando hay datos inválidos', async () => {
        const { next, res } = await run([body('name').notEmpty().withMessage('El nombre es obligatorio')], {});
        expect(next.called).to.be.false;
        expect(res.status.calledWith(400)).to.be.true;
        expect(res.json.firstCall.args[0]).to.deep.equal({
            statusCode: 400,
            status: 'error',
            errors: [{ name: 'El nombre es obligatorio' }]
        });
    });
});
