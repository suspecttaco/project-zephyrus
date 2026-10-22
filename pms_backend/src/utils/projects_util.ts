import { In } from 'typeorm';
import { DatabaseUtil } from './db';
import { Projects } from '../components/projects/projects_entity';
import { Users } from '../components/users/users_entity';

export class ProjectsUtil {
    public static async getProjectMemberEmails(projectId: string): Promise<string[]> {
        if (!projectId) return [];
        const dbUtil = new DatabaseUtil();
        const projectRepo = dbUtil.getRepository(Projects);
        const project = await projectRepo.findOne({
            where: { project_id: projectId }
        });
        if (!project || !project.user_ids || project.user_ids.length === 0) {
            return [];
        }
        const userRepo = dbUtil.getRepository(Users);
        const users = await userRepo.find({ where: { user_id: In(project.user_ids) } });
        return users.map((u: any) => u.email).filter((email: any) => email);
    }
}
