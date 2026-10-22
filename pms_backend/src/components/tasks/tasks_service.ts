import { Repository } from "typeorm";
import { BaseService, IApiResponse } from "../../utils/base_service";
import { DatabaseUtil } from "../../utils/db";
import { Tasks, Status } from "./tasks_entity";
import { TaskWorkflow, WorkflowAction } from "../../domain/task_workflow";
import { TaskTransactionService } from "./task_transaction_service";
import { Projects } from "../projects/projects_entity";
import { Users } from "../users/users_entity";

export class TaskService extends BaseService<Tasks> {
    private dbUtil: DatabaseUtil;
    constructor() {
        const dbutil = new DatabaseUtil();
        const repository: Repository<Tasks> = dbutil.getRepository(Tasks);
        super(repository, 'task_id');
        this.dbUtil = dbutil;
        this.findOptions = { loadRelationIds: true };
        this.writableFields = ['name', 'description', 'project_id', 'user_id', 'estimated_start_time', 'estimated_end_time',
            'actual_start_time', 'actual_end_time', 'priority', 'status', 'supported_files'];
    }

    private async checkReferences(data: any, required: boolean): Promise<IApiResponse<Tasks> | null> {
        try {
            if (required || data.project_id !== undefined) {
                const project = data.project_id ? await this.dbUtil.getRepository(Projects).findOneBy({ project_id: data.project_id }) : null;
                if (!project) {
                    return { statusCode: 404, status: 'error', message: 'El proyecto indicado no existe' };
                }
            }
            if (required || (data.user_id !== undefined && data.user_id !== null)) {
                const user = data.user_id ? await this.dbUtil.getRepository(Users).findOneBy({ user_id: data.user_id }) : null;
                if (!user) {
                    return { statusCode: 404, status: 'error', message: 'El usuario asignado no existe' };
                }
            }
        } catch (error: any) {
            return this.handleError(error);
        }
        return null;
    }

    public async create(data: any): Promise<IApiResponse<Tasks>> {
        const prepared = this.prepare(data);
        return (await this.checkReferences(prepared, true)) ?? super.create(data);
    }

    public async update(id: string, data: any): Promise<IApiResponse<Tasks>> {
        const prepared = this.prepare(data);
        return (await this.checkReferences(prepared, false)) ?? super.update(id, data);
    }

    public async createTask(taskData: Partial<Tasks>, projectId?: string, assignedUserId?: string): Promise<any> {
        const taskRepo = this.dbUtil.getRepository(Tasks);
        const data: any = { ...taskData };
        if (projectId) data.project_id = projectId;
        if (assignedUserId) data.user_id = assignedUserId;
        const task = taskRepo.create(data);
        return await taskRepo.save(task);
    }

    private async loadForWorkflow(taskId: string): Promise<Tasks | null> {
        return this.dbUtil.getRepository(Tasks).findOne({ where: { task_id: taskId }, loadRelationIds: true });
    }

    public async updateTaskStatus(taskId: string, status: string): Promise<Tasks | null> {
        const task = await this.loadForWorkflow(taskId);
        if (!task) return null;
        const workflow = new TaskWorkflow(taskId, task.status);
        const before = workflow.getStatus();
        workflow.moveTo(status as Status);
        if (workflow.getStatus() === Status.InProgress && before !== Status.InProgress) {
            return new TaskTransactionService().startTaskWithLimit(taskId);
        }
        return this.saveStatus(task, workflow.getStatus());
    }

    public async performWorkflowAction(taskId: string, action: WorkflowAction): Promise<Tasks | null> {
        const task = await this.loadForWorkflow(taskId);
        if (!task) return null;
        const workflow = new TaskWorkflow(taskId, task.status);
        const before = workflow.getStatus();
        workflow.perform(action);
        if (workflow.getStatus() === Status.InProgress && before !== Status.InProgress) {
            return new TaskTransactionService().startTaskWithLimit(taskId);
        }
        return this.saveStatus(task, workflow.getStatus());
    }

    private async saveStatus(task: Tasks, status: Status): Promise<Tasks> {
        if (task.status === status) return task;
        task.status = status;
        if (status === Status.InProgress && !task.actual_start_time) {
            task.actual_start_time = new Date();
        } else if (status === Status.Completed) {
            task.actual_start_time = task.actual_start_time ?? new Date();
            task.actual_end_time = new Date();
        }
        return this.dbUtil.getRepository(Tasks).save(task);
    }
}
