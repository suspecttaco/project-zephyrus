import { Repository } from "typeorm";
import { BaseService, IApiResponse } from "../../utils/base_service";
import { DatabaseUtil } from "../../utils/db";
import { Users } from "./users_entity";

export class UserService extends BaseService<Users> {
    constructor() {
        const dbutil = new DatabaseUtil();
        const repository: Repository<Users> = dbutil.getRepository(Users);
        super(repository, 'user_id');
        this.findOptions = { loadRelationIds: true };
        this.writableFields = ['fullname', 'username', 'email', 'password', 'role_ids'];
    }

    protected prepare(data: any): any {
        const clean = super.prepare(data);
        if (Array.isArray(clean?.role_ids)) {
            return { ...clean, role_ids: clean.role_ids.map((id: any) => (typeof id === 'string' ? { role_id: id } : id)) };
        }
        return clean;
    }

    public async create(data: any): Promise<IApiResponse<Users>> {
        return this.withRoleIds(await super.create(data));
    }

    public async update(id: string, data: any): Promise<IApiResponse<Users>> {
        return this.withRoleIds(await super.update(id, data));
    }

    private withRoleIds(result: IApiResponse<Users>): IApiResponse<Users> {
        const user = result.data as any;
        if (user && !Array.isArray(user) && Array.isArray(user.role_ids)) {
            user.role_ids = user.role_ids.map((role: any) => (typeof role === 'string' ? role : role.role_id));
        }
        return result;
    }
}
