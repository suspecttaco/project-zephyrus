import { Rights, encryptString } from "./common";
import { RoleService } from "../components/roles/roles_service";
import { DatabaseUtil } from "./db";
import { UserService } from "../components/users/users_service";

export class DDLUtil {
    public static async addDefaultRoleAndUser(): Promise<void> {
        new DatabaseUtil();
        await DatabaseUtil.waitUntilReady();

        const roleService = new RoleService();
        const allRights = Object.values(Rights)
            .map((grupo) => grupo.ALL)
            .join(',');

        const roleResult = await roleService.create({
            name: 'SuperAdmin',
            description: 'Acceso total con todos los derechos del sistema',
            rights: allRights
        });
        console.log('Resultado de Agregar Rol por Defecto:');
        console.log(JSON.stringify(roleResult, null, 2));

        if (roleResult.statusCode !== 201 || !roleResult.data) {
            return;
        }

        const role = roleResult.data as any;
        const userService = new UserService();
        const userResult = await userService.create({
            fullname: 'Super Admin',
            username: 'superadmin',
            email: 'superadmin@pms.com',
            password: await encryptString('SuperAdmin123!'),
            role_ids: [role.role_id]
        });
        console.log('Resultado de Agregar Usuario por Defecto:');
        const { password, ...userWithoutPassword } = (userResult.data ?? {}) as any;
        console.log(JSON.stringify({ ...userResult, data: userResult.data ? userWithoutPassword : undefined }, null, 2));
    }
}
