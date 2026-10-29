import { randomUUID } from "node:crypto";
import { User } from "../../domain/entities/user.js";
import type { IUserRepository } from "../../domain/repositories/user-repository.js";
import { EmailAlreadyRegisteredError } from "../../domain/errors.js";

export class RegisterUser {
    constructor(private readonly userRepository: IUserRepository) {}

    async execute(input: { email: string; password: string; name: string }): Promise<User> {
        const existing = await this.userRepository.findByEmail(input.email);
        if (existing) throw new EmailAlreadyRegisteredError("email already registered");

        const user = User.create({
            id: randomUUID(),
            email: input.email,
            passwordHash: input.password,
            name: input.name,
        });
        await this.userRepository.save(user);
        return user;
    }
}
