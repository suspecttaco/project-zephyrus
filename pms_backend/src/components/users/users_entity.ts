import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToMany, JoinTable } from "typeorm";
import { Roles } from "../roles/roles_entity";

@Entity('users')
export class Users {
    @PrimaryGeneratedColumn('uuid')
    user_id!: string;

    @Column({ length: 50, nullable: true })
    fullname!: string;

    @Column({ length: 30, nullable: false, unique: true })
    username!: string;

    @Column({ length: 60, nullable: false, unique: true })
    email!: string;

    @Column({ nullable: false })
    password!: string;

    @ManyToMany(() => Roles)
    @JoinTable({
        name: 'user_roles',
        joinColumn: { name: 'user_id', referencedColumnName: 'user_id' },
        inverseJoinColumn: { name: 'role_id', referencedColumnName: 'role_id' }
    })
    role_ids!: string[];

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;
}