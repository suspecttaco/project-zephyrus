import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity('roles')
export class Roles {
    @PrimaryGeneratedColumn('uuid')
    role_id!: string;

    @Column({ length: 60, nullable: false, unique: true })
    name!: string;

    @Column({ length: 200, nullable: true})
    description!: string;

    @Column({ type: 'text', nullable: false })
    rights!: string;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;
}