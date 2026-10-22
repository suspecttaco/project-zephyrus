export abstract class BaseReportGenerator {
    public abstract readonly contentType: string;
    public abstract readonly extension: string;

    public async generate(projectId: string): Promise<Buffer> {
        const rawData = await this.fetchData(projectId);
        const formatted = this.formatData(rawData);
        const resultBuffer = await this.exportFile(formatted);
        await this.auditLog(projectId);
        return resultBuffer;
    }

    protected abstract fetchData(projectId: string): Promise<any>;
    protected abstract formatData(data: any): any;
    protected abstract exportFile(formattedData: any): Promise<Buffer>;

    protected async auditLog(projectId: string): Promise<void> {
        console.log(`[Audit] Reporte compilado para proyecto ${projectId}`);
    }
}
