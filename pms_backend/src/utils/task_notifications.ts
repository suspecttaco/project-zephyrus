import { ProjectsUtil } from './projects_util';
import { NotificationUtil } from './notification_util';

export const escapeHtml = (text: string): string =>
    String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export class TaskNotifications {
    public static async notifyMembers(projectId: string, subject: string, html: string): Promise<void> {
        const emails = [...new Set(await ProjectsUtil.getProjectMemberEmails(projectId))];
        await Promise.all(emails.map((email) => NotificationUtil.enqueueEmail(email, subject, html)));
    }

    private static dispatch(projectId: string, subject: string, html: string): void {
        TaskNotifications.notifyMembers(projectId, subject, html)
            .catch((error: any) => console.error(`[ERROR] No se pudo encolar la notificación: ${error.message}`));
    }

    public static taskCreated(task: { name: string; project_id: string }): void {
        TaskNotifications.dispatch(
            task.project_id,
            `Nueva Tarea Creada: ${task.name}`,
            `<p>Hola, se ha creado la tarea <b>${escapeHtml(task.name)}</b> en tu proyecto.</p>`
        );
    }

    public static taskStatusChanged(task: { name: string; status: string; project_id: string }): void {
        TaskNotifications.dispatch(
            task.project_id,
            `Cambio de estado en la tarea: ${task.name}`,
            `<p>La tarea <b>${escapeHtml(task.name)}</b> cambió su estado a <b>${escapeHtml(task.status)}</b>.</p>`
        );
    }
}
