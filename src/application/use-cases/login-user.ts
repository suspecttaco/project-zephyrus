import type { IUserRepository } from "../../domain/repositories/user-repository.js";
import type { User } from "../../domain/entities/user.js";
import { InvalidCredentialsError } from "../../domain/errors.js";

export class LoginUser {
    constructor(private readonly userRepository: IUserRepository) {}

    async execute(input: { email: string; password: string }): Promise<User> {
        const user = await this.userRepository.findByEmail(input.email);
        if (user?.passwordHash !== input.password) throw new InvalidCredentialsError("invalid credentials");

        return user;
    }
}
