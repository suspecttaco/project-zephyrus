import sinon from 'sinon';
import request from 'supertest';
import { expect } from 'chai';
import { app } from '../../src/app';
import { CommentService } from '../../src/components/comments/comments_service';
import { fakeUser, ok, stubAuth } from '../helpers/auth';

const TASK_ID = '44444444-4444-4444-8444-444444444444';
const COMMENT_ID = '55555555-5555-4555-8555-555555555555';

describe('Pruebas de integración: comentarios (/api/comments)', () => {
    afterEach(() => sinon.restore());

    it('exige autenticación (401)', async () => {
        expect((await request(app).get('/api/comments')).status).to.equal(401);
    });

    it('exige el derecho add_comment (403)', async () => {
        const token = stubAuth([]);
        const res = await request(app).post('/api/comments').set('Authorization', `Bearer ${token}`).send({ comment: 'hola', task_id: TASK_ID });
        expect(res.status).to.equal(403);
    });

    it('valida comentario y tarea (400)', async () => {
        const token = stubAuth(['add_comment']);
        const res = await request(app).post('/api/comments').set('Authorization', `Bearer ${token}`).send({ comment: '  ', task_id: 'x' });
        expect(res.status).to.equal(400);
    });

    it('toma el autor del token y no del cuerpo de la petición (201)', async () => {
        const token = stubAuth(['add_comment']);
        const create = sinon.stub(CommentService.prototype, 'create').resolves(ok({ comment_id: COMMENT_ID }, 201));

        const res = await request(app).post('/api/comments').set('Authorization', `Bearer ${token}`)
            .send({ comment: 'Avance listo', task_id: TASK_ID, user_id: 'suplantado' });

        expect(res.status).to.equal(201);
        expect(create.firstCall.args[0]).to.include({ user_id: fakeUser.user_id, task_id: TASK_ID });
    });

    it('al editar solo se modifica el texto, no el autor ni la tarea', async () => {
        const token = stubAuth(['edit_comment']);
        const update = sinon.stub(CommentService.prototype, 'update').resolves(ok({ comment_id: COMMENT_ID }));

        const res = await request(app).put(`/api/comments/${COMMENT_ID}`).set('Authorization', `Bearer ${token}`)
            .send({ comment: 'Editado', user_id: 'otro', task_id: 'otra' });

        expect(res.status).to.equal(200);
        const sent = update.firstCall.args[1];
        expect(sent.comment).to.equal('Editado');
        expect(sent).to.not.have.property('user_id');
        expect(sent).to.not.have.property('task_id');
    });

    it('GET /:id retorna 404 si no existe', async () => {
        const token = stubAuth(['get_details_comment']);
        sinon.stub(CommentService.prototype, 'findOne').resolves({ statusCode: 404, status: 'error', message: 'Recurso no encontrado' });
        const res = await request(app).get(`/api/comments/${COMMENT_ID}`).set('Authorization', `Bearer ${token}`);
        expect(res.status).to.equal(404);
    });

    it('DELETE exige el derecho delete_comment (403)', async () => {
        const token = stubAuth(['add_comment']);
        const res = await request(app).delete(`/api/comments/${COMMENT_ID}`).set('Authorization', `Bearer ${token}`);
        expect(res.status).to.equal(403);
    });
});
