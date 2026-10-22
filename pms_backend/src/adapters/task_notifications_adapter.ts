import { Task } from '../domain/entities/task';
import { ITaskNotifier } from '../domain/repositories/task_repository';
import { TaskNotifications } from '../utils/task_notifications';

export class TaskNotificationsAdapter implements ITaskNotifier {
    notifyTaskCreated(task: Task): void {
        TaskNotifications.taskCreated({ name: task.name, project_id: task.projectId });
    }
}
