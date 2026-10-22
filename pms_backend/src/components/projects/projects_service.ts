import { Repository } from "typeorm";
import { BaseService } from "../../utils/base_service";
import { DatabaseUtil } from "../../utils/db";
import { Projects } from "./projects_entity";
import { Tasks, Priority, Status } from "../tasks/tasks_entity";

export class ProjectService extends BaseService<Projects> {
    private dbUtil: DatabaseUtil;
    constructor() {
        const dbutil = new DatabaseUtil();
        const repository: Repository<Projects> = dbutil.getRepository(Projects);
        super(repository, 'project_id');
        this.dbUtil = dbutil;
        this.writableFields = ['name', 'description', 'user_ids', 'status', 'start_time', 'end_time'];
    }

    public async createProject(projectData: Partial<Projects>, ownerId?: string): Promise<any> {
        const projectRepo = this.dbUtil.getRepository(Projects);
        const data: any = { ...this.prepare(projectData) };
        if (ownerId && !data.user_ids) {
            data.user_ids = [ownerId];
        }
        const project = projectRepo.create(data);
        return await projectRepo.save(project);
    }

    public async getProjectById(projectId: string): Promise<Projects | null> {
        const projectRepo = this.dbUtil.getRepository(Projects);
        return await projectRepo.findOne({
            where: { project_id: projectId }
        });
    }

    public async getAllProjectsCustom(queryParams: any = {}): Promise<any[]> {
        const projectRepo = this.dbUtil.getRepository(Projects);
        const qb = projectRepo.createQueryBuilder('project');

        if (queryParams.status) {
            qb.andWhere('project.status = :status', { status: queryParams.status });
        }
        if (queryParams.search) {
            qb.andWhere('project.name ILIKE :search', { search: `%${queryParams.search}%` });
        }
        qb.orderBy('project.created_at', 'DESC');

        if (queryParams.page || queryParams.limit) {
            const page = Math.max(parseInt(queryParams.page) || 1, 1);
            const limit = Math.min(Math.max(parseInt(queryParams.limit) || 20, 1), 100);
            qb.skip((page - 1) * limit).take(limit);
        }
        return await qb.getMany();
    }

    public async createProjectWithDefaultTask(projectData: any, ownerId: string): Promise<Projects> {
        const queryRunner = this.dbUtil.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            const project = queryRunner.manager.create(Projects, {
                ...this.prepare(projectData),
                user_ids: projectData.user_ids || [ownerId]
            });
            const savedProject = await queryRunner.manager.save(project);

            const defaultTask = queryRunner.manager.create(Tasks, {
                name: 'Planificación Inicial',
                description: 'Tarea generada automáticamente al crear el proyecto',
                status: Status.NotStarted,
                priority: Priority.High,
                project_id: savedProject.project_id,
                user_id: ownerId
            });
            await queryRunner.manager.save(defaultTask);

            await queryRunner.commitTransaction();
            return savedProject;
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    public async deleteProject(projectId: string): Promise<boolean> {
        const projectRepo = this.dbUtil.getRepository(Projects);
        const result = await projectRepo.delete({ project_id: projectId });
        return (result.affected ?? 0) > 0;
    }
}
