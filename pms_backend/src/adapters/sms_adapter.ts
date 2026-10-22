import { HttpClientBuilder } from '../builders/http_client_builder';

export interface ISmsNotifier {
    sendSms(phoneNumber: string, message: string): Promise<boolean>;
}

export interface ISmsProviderClient {
    dispatchMessage(opts: { to: string; body: string; fromNumber: string }): Promise<{ status: string }>;
}

export class SimulatedSmsProviderClient implements ISmsProviderClient {
    public async dispatchMessage(opts: { to: string; body: string; fromNumber: string }): Promise<{ status: string }> {
        console.log(`[SMS simulado] ${opts.fromNumber} -> ${opts.to}: ${opts.body}`);
        return { status: 'delivered' };
    }
}

export class HttpSmsProviderClient implements ISmsProviderClient {
    private readonly http;

    constructor(baseUrl: string, token?: string) {
        const builder = new HttpClientBuilder().setBaseUrl(baseUrl).setTimeout(5000).setRetries(2);
        if (token) builder.setBearerToken(token);
        this.http = builder.build();
    }

    public async dispatchMessage(opts: { to: string; body: string; fromNumber: string }): Promise<{ status: string }> {
        const response = await this.http.post('/messages', { to: opts.to, body: opts.body, from: opts.fromNumber });
        return { status: response.data?.status ?? 'delivered' };
    }
}

export function defaultSmsProviderClient(): ISmsProviderClient {
    return process.env.SMS_API_URL
        ? new HttpSmsProviderClient(process.env.SMS_API_URL, process.env.SMS_API_TOKEN)
        : new SimulatedSmsProviderClient();
}

export class TwilioSmsAdapter implements ISmsNotifier {
    constructor(
        private readonly fromNumber: string,
        private readonly client: ISmsProviderClient = defaultSmsProviderClient()
    ) {}

    public async sendSms(phoneNumber: string, message: string): Promise<boolean> {
        try {
            const response = await this.client.dispatchMessage({ to: phoneNumber, body: message, fromNumber: this.fromNumber });
            return response.status === 'delivered';
        } catch (error: any) {
            console.error('Error en TwilioSmsAdapter:', error.message);
            return false;
        }
    }
}
