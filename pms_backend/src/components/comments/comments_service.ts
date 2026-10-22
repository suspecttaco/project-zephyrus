import { Repository } from "typeorm";
import { DatabaseUtil } from "../../utils/db";
import { BaseService, IApiResponse } from "../../utils/base_service";
import { Comments } from "./comments_entity";
import { Tasks } from "../tasks/tasks_entity";

export class CommentService extends BaseService<Comments> {
    private dbUtil: DatabaseUtil;
    constructor() {
        const dbutil = new DatabaseUtil();
        const repository: Repository<Comments> = dbutil.getRepository(Comments);
        super(repository, 'comment_id');
        this.dbUtil = dbutil;
        this.findOptions = { loadRelationIds: true };
        this.writableFields = ['comment', 'task_id', 'user_id', 'supported_files'];
    }

    public async create(data: any): Promise<IApiResponse<Comments>> {
        try {
            const task = await this.dbUtil.getRepository(Tasks).findOneBy({ task_id: data.task_id });
            if (!task) {
                return { statusCode: 404, status: 'error', message: 'La tarea indicada no existe' };
            }
        } catch (error: any) {
            return this.handleError(error);
        }
        return super.create(data);
    }
}
