import { UserService } from "../components/users/users_service";
import { CacheUtil } from "./cache_util";

export class UsersUtil {
    public static async putAllUsersInCache(): Promise<void> {
        try {
            const userService = new UserService();
            const result = await userService.findAll({});
            if (result.statusCode === 200 && Array.isArray(result.data)) {
                const users = result.data;
                users.forEach((user: any) => {
                    delete user.password;
                    CacheUtil.set('User', user.user_id, user);
                });
                console.log('Todos los usuarios han sido cargados exitosamente en la caché');
            } else {
                console.error(`Error al ejecutar putAllUsersInCache: ${result.message}`);
            }
        } catch (error: any) {
            console.error(`Error al ejecutar putAllUsersInCache: ${error.message}`);
        }
    }
}
