import { Express, Router } from "express";
import { RoleRoutes } from "../components/roles/roles_routes";
import { UserRoutes } from "../components/users/users_routes";
import { ProjectRoutes } from "../components/projects/projects_routes";
import { TaskRoutes } from "../components/tasks/tasks_routes";
import { CommentRoutes } from "../components/comments/comments_routes";
import { HealthRoutes } from "../components/health/health_routes";
import { AuditRoutes } from "../components/audit/audit_routes";
import { AnalyticsRoutes } from "../components/analytics/analytics_routes";

export class Routes {
    public router!: Router;

    constructor(app: Express) {
        const routeClasses = [
            RoleRoutes,
            UserRoutes,
            ProjectRoutes,
            TaskRoutes,
            CommentRoutes,
            HealthRoutes,
            AuditRoutes,
            AnalyticsRoutes
        ];

        for (const RouteClass of routeClasses) {
            try {
                new RouteClass(app);
                console.log(`Router: ${RouteClass.name} - Connected`);
            } catch (error) {
                console.log(`Router: ${RouteClass.name} - Failed:`, error);
            }
        }
    }
}