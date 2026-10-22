import { Repository } from "typeorm";
import { BaseService } from "../../utils/base_service";
import { DatabaseUtil } from "../../utils/db";
import { Roles } from "./roles_entity";

export class RoleService extends BaseService<Roles> {
    constructor() {
        const dbutil = new DatabaseUtil();
        const repository: Repository<Roles> = dbutil.getRepository(Roles);
        super(repository, 'role_id');
        this.writableFields = ['name', 'description', 'rights'];
    }
}