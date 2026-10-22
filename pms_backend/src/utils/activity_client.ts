import { AxiosInstance } from 'axios';
import { HttpClientBuilder } from '../builders/http_client_builder';
import { ActivityEvent } from '../engines/activity_logger_service';

export class ActivityUnavailableError extends Error {
    constructor() {
        super('El servicio de actividad no está disponible');
    }
}

export class ActivityClient {
    private readonly http: AxiosInstance;

    constructor(baseUrl = process.env.ACTIVITY_URL || 'http://127.0.0.1:4100', token = process.env.ACTIVITY_TOKEN) {
        const builder = new HttpClientBuilder().setBaseUrl(baseUrl).setTimeout(2000).setRetries(1);
        if (token) builder.addHeader('X-Internal-Token', token);
        this.http = builder.build();
    }

    private async call<T>(request: () => Promise<{ data: { data: T } }>): Promise<T> {
        try {
            return (await request()).data.data;
        } catch (error: any) {
            if (!error.response) throw new ActivityUnavailableError();
            throw error;
        }
    }

    public record(taskId: string, userId: string | null, action: string, details?: unknown): Promise<ActivityEvent> {
        return this.call(() => this.http.post('/events', { taskId, userId, action, details }));
    }

    public history(taskId: string, limit = 100, order: 'asc' | 'desc' = 'asc'): Promise<ActivityEvent[]> {
        return this.call(() => this.http.get(`/tasks/${encodeURIComponent(taskId)}/events`, { params: { limit, order } }));
    }

    public async last(taskId: string): Promise<ActivityEvent | null> {
        try {
            return await this.call(() => this.http.get(`/tasks/${encodeURIComponent(taskId)}/last`));
        } catch (error: any) {
            if (error.response?.status === 404) return null;
            throw error;
        }
    }
}

let warned = false;

export const ActivityLog = {
    record(taskId: string, userId: string | null | undefined, action: string, details?: unknown): void {
        if (process.env.ACTIVITY_DISABLED === 'true') return;
        new ActivityClient().record(taskId, userId ?? null, action, details).then(() => { warned = false; }).catch((error: any) => {
            if (!warned) {
                warned = true;
                console.error(`[Actividad] No se pudo registrar el evento ${action}: ${error.message}`);
            }
        });
    }
};
