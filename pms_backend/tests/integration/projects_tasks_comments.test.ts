import { expect } from 'chai';
import { DatabaseUtil } from '../../src/utils/db';
import { ProjectService } from '../../src/components/projects/projects_service';
import { api, auth, login, uniq } from './helpers';

const countRows = async (sql: string, params: any[]): Promise<number> =>
    Number((await new DatabaseUtil().getDataSource().query(sql, params))[0].count);

describe('Integración (PostgreSQL real): proyectos, tareas y comentarios', () => {
    let admin: string;
    let adminId: string;

    before(async () => {
        admin = (await login()).access;
        adminId = (await api().get('/api/users?username=superadmin').set(auth(admin))).body.data[0].user_id;
    });

    const newProject = async (extra: object = {}) =>
        (await api().post('/api/projects').set(auth(admin)).send({ name: `P${uniq()}`, ...extra })).body.data;
    const newTask = async (projectId: string, extra: object = {}) =>
        api().post('/api/tasks').set(auth(admin)).send({ name: `T${uniq()}`, project_id: projectId, user_id: adminId, ...extra });

    describe('proyectos', () => {
        it('crea un proyecto en estado Planning con el creador como miembro', async () => {
            const res = await api().post('/api/projects').set(auth(admin)).send({ name: `P${uniq()}`, start_time: '2026-11-01', end_time: '2026-12-01' });
            expect(res.status).to.equal(201);
            expect(res.body.data.status).to.equal('Planning');
            expect(res.body.data.user_ids).to.deep.equal([adminId]);
        });

        it('rechaza nombre duplicado (409), fechas invertidas (400) y UUID inválido (400)', async () => {
            const project = await newProject();
            expect((await api().post('/api/projects').set(auth(admin)).send({ name: project.name })).status).to.equal(409);
            expect((await api().post('/api/projects').set(auth(admin)).send({ name: `F${uniq()}`, start_time: '2026-12-31', end_time: '2026-11-01' })).status).to.equal(400);
            expect((await api().get('/api/projects/no-es-uuid').set(auth(admin))).status).to.equal(400);
        });

        it('renombrar a un nombre existente da 409', async () => {
            const a = await newProject();
            const b = await newProject();
            expect((await api().put(`/api/projects/${b.project_id}`).set(auth(admin)).send({ name: a.name })).status).to.equal(409);
        });

        it('filtra por estado y búsqueda, y pagina', async () => {
            const marker = `Filtro${uniq()}`;
            const project = await newProject({ name: marker });
            await api().put(`/api/projects/${project.project_id}`).set(auth(admin)).send({ name: marker, status: 'Archived' });

            const found = await api().get(`/api/projects?status=Archived&search=${marker}`).set(auth(admin));
            expect(found.body.data).to.have.lengthOf(1);
            expect((await api().get('/api/projects?status=Inventado').set(auth(admin))).status).to.equal(400);

            await newProject();
            await newProject();
            const page = await api().get('/api/projects?page=1&limit=2').set(auth(admin));
            expect(page.body.data).to.have.lengthOf(2);
        });

        it('crear con tarea por defecto guarda proyecto y tarea en la misma transacción', async () => {
            const res = await api().post('/api/projects/with-default-task').set(auth(admin)).send({ name: `Tx${uniq()}` });
            expect(res.status).to.equal(201);
            expect(await countRows('select count(*) from tasks where project_id = $1', [res.body.data.project_id])).to.equal(1);
        });

        it('hace rollback completo si falla la tarea por defecto (no quedan proyectos huérfanos)', async () => {
            const name = `Rollback${uniq()}`;
            let error: any;
            try {
                await new ProjectService().createProjectWithDefaultTask({ name }, '99999999-9999-4999-8999-999999999999');
            } catch (e) {
                error = e;
            }
            expect(error, 'debía fallar').to.exist;
            expect(await countRows('select count(*) from projects where name = $1', [name])).to.equal(0);
        });

        it('no elimina un proyecto con tareas (409) y sí uno vacío', async () => {
            const project = await newProject();
            const task = (await newTask(project.project_id)).body.data;
            expect((await api().delete(`/api/projects/${project.project_id}`).set(auth(admin))).status).to.equal(409);
            await api().delete(`/api/tasks/${task.task_id}`).set(auth(admin));
            expect((await api().delete(`/api/projects/${project.project_id}`).set(auth(admin))).status).to.equal(200);
        });
    });

    describe('tareas', () => {
        let project: any;
        before(async () => { project = await newProject(); });

        it('al leer una tarea devuelve el proyecto y el usuario asignado', async () => {
            const task = (await newTask(project.project_id)).body.data;
            const one = await api().get(`/api/tasks/${task.task_id}`).set(auth(admin));
            expect(one.body.data.project_id).to.equal(project.project_id);
            expect(one.body.data.user_id).to.equal(adminId);

            const list = await api().get(`/api/tasks?project_id=${project.project_id}`).set(auth(admin));
            expect(list.body.data.map((t: any) => t.task_id)).to.include(task.task_id);
            expect(list.body.data.every((t: any) => t.project_id === project.project_id)).to.be.true;
        });

        it('el nombre es único por proyecto, no global', async () => {
            const name = `Unica${uniq()}`;
            const other = await newProject();
            expect((await newTask(project.project_id, { name })).status).to.equal(201);
            expect((await newTask(project.project_id, { name })).status).to.equal(409);
            expect((await newTask(other.project_id, { name })).status).to.equal(201);
        });

        it('responde 404 si el proyecto o el usuario no existen, 400 si faltan o son inválidos', async () => {
            const ghost = '00000000-0000-4000-8000-000000000000';
            expect((await newTask(ghost)).status).to.equal(404);
            expect((await newTask(project.project_id, { user_id: ghost })).status).to.equal(404);
            expect((await newTask('no-uuid')).status).to.equal(400);
            expect((await newTask(project.project_id, { priority: 'Urgente' })).status).to.equal(400);
        });

        it('registra la hora real de inicio y de fin al cambiar el estado', async () => {
            const task = (await newTask(project.project_id)).body.data;
            const started = await api().put(`/api/tasks/${task.task_id}/status`).set(auth(admin)).send({ status: 'In-Progress' });
            expect(started.body.data.actual_start_time).to.be.a('string');
            expect(started.body.data.actual_end_time).to.equal(null);

            const review = await api().put(`/api/tasks/${task.task_id}/status`).set(auth(admin)).send({ status: 'In-Review' });
            expect(review.status).to.equal(200);
            const done = await api().put(`/api/tasks/${task.task_id}/status`).set(auth(admin)).send({ status: 'Completed' });
            expect(done.body.data.actual_end_time).to.be.a('string');
            expect((await api().put(`/api/tasks/${task.task_id}/status`).set(auth(admin)).send({ status: 'Hecho' })).status).to.equal(400);
        });

        it('la actualización valida los datos y no deja guardar basura', async () => {
            const task = (await newTask(project.project_id)).body.data;
            const put = (body: object) => api().put(`/api/tasks/${task.task_id}`).set(auth(admin)).send(body);
            expect((await put({ name: '' })).status).to.equal(400);
            expect((await put({ estimated_start_time: '2026-12-01', estimated_end_time: '2026-11-01' })).status).to.equal(400);
            expect((await put({ project_id: '00000000-0000-4000-8000-000000000000' })).status).to.equal(404);
            expect((await put({ description: 'válida', priority: 'Low' })).status).to.equal(200);
            expect((await api().get(`/api/tasks/${task.task_id}`).set(auth(admin))).body.data.name).to.equal(task.name);
        });
    });

    describe('comentarios', () => {
        it('el autor sale del token, la lectura devuelve tarea y autor, y solo se edita el texto', async () => {
            const project = await newProject();
            const task = (await newTask(project.project_id)).body.data;

            const created = await api().post('/api/comments').set(auth(admin)).send({ comment: 'Avance', task_id: task.task_id, user_id: 'suplantado' });
            expect(created.status).to.equal(201);
            const id = created.body.data.comment_id;

            const read = await api().get(`/api/comments/${id}`).set(auth(admin));
            expect(read.body.data.user_id).to.equal(adminId);
            expect(read.body.data.task_id).to.equal(task.task_id);

            const edited = await api().put(`/api/comments/${id}`).set(auth(admin)).send({ comment: 'Editado', user_id: 'otro', task_id: 'otra' });
            expect(edited.status).to.equal(200);
            const after = (await api().get(`/api/comments/${id}`).set(auth(admin))).body.data;
            expect(after).to.include({ comment: 'Editado', user_id: adminId, task_id: task.task_id });

            const list = await api().get(`/api/comments?task_id=${task.task_id}`).set(auth(admin));
            expect(list.body.data).to.have.lengthOf(1);

            expect((await api().delete(`/api/comments/${id}`).set(auth(admin))).status).to.equal(200);
            expect((await api().get(`/api/comments/${id}`).set(auth(admin))).status).to.equal(404);
        });

        it('rechaza comentar una tarea inexistente (404) o con datos inválidos (400)', async () => {
            const ghost = '00000000-0000-4000-8000-000000000000';
            expect((await api().post('/api/comments').set(auth(admin)).send({ comment: 'x', task_id: ghost })).status).to.equal(404);
            expect((await api().post('/api/comments').set(auth(admin)).send({ comment: ' ', task_id: 'x' })).status).to.equal(400);
        });
    });
});
