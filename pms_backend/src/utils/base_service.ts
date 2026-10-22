import {Repository, FindOptionsWhere, ObjectLiteral} from "typeorm";

export interface IApiResponse<T> {
    statusCode: number;
    status: 'success' | 'error';
    data?: T | T[];
    message?: string;
    errors?: any[];
}

export class BaseService<T extends ObjectLiteral> {
    protected repository: Repository<T>;
    protected primaryKey: string;
    protected findOptions: Record<string, any> = {};
    protected writableFields?: string[];

    constructor(repository: Repository<T>, primaryKey: string = 'id') {
        this.repository = repository;
        this.primaryKey = primaryKey;
    }

    protected prepare(data: any): any {
        if (!this.writableFields || !data) {
            return data;
        }
        return Object.fromEntries(Object.entries(data).filter(([key]) => this.writableFields!.includes(key)));
    }

    protected handleError(error: any): IApiResponse<T> {
        switch (error.code) {
            case '23505':
                return { statusCode: 409, status: 'error', message: error.detail || 'El registro ya existe' };
            case '23503':
                return { statusCode: 409, status: 'error', message: error.detail || 'Violación de integridad referencial' };
            case '22P02':
                return { statusCode: 400, status: 'error', message: 'Identificador o valor con formato inválido' };
            case '22001':
                return { statusCode: 400, status: 'error', message: 'Un valor excede la longitud permitida' };
            default:
                return { statusCode: 500, status: 'error', message: error.message };
        }
    }

    public async create(data: any): Promise<IApiResponse<T>> {
        try {
            const entity = this.repository.create(this.prepare(data));
            const result = await this.repository.save(entity);
            return { statusCode: 201, status: 'success', data: result };
        } catch (error: any) {
            return this.handleError(error);
        }
    }

    public async findAll(queryParams: any = {}): Promise<IApiResponse<T>> {
        try {
            const results = await this.repository.find({ where: queryParams as FindOptionsWhere<T>, ...this.findOptions });
            return { statusCode: 200, status: 'success', data: results };
        } catch (error: any) {
            return this.handleError(error);
        }
    }

    public async findOne(id: string): Promise<IApiResponse<T>> {
        try {
            const result = await this.repository.findOne({ where: { [this.primaryKey]: id } as any, ...this.findOptions });
            if (!result) {
                return { statusCode: 404, status: 'error', message: 'Recurso no encontrado' };
            }
            return { statusCode: 200, status: 'success', data: result };
        } catch (error: any) {
            return this.handleError(error);
        }
    }

    public async update(id: string, data: any): Promise<IApiResponse<T>> {
        try {
            const existing = await this.repository.findOne({ where: { [this.primaryKey]: id } as any });
            if (!existing) {
                return { statusCode: 404, status: 'error', message: 'Recurso no encontrado para actualizar' };
            }
            this.repository.merge(existing, this.prepare(data));
            const updated = await this.repository.save(existing);
            return { statusCode: 200, status: 'success', data: updated };
        } catch (error: any) {
            return this.handleError(error);
        }
    }

    public async delete(id: string): Promise<IApiResponse<T>> {
        try {
            const result = await this.repository.delete({ [this.primaryKey]: id } as any);
            if (result.affected === 0) {
                return { statusCode: 404, status: 'error', message: 'Recurso no encontrado para eliminar' };
            }
            return { statusCode: 200, status: 'success', message: 'Registro eliminado exitosamente' };
        } catch (error: any) {
            return this.handleError(error);
        }
    }
}

