import { EvUsersRepository } from "../db/EvUserRepository.js";
import type { EvUser } from "../../generated/prisma/index.js";
import { HttpError } from "../lib/httpError.js";
import { verifyPassword } from "../lib/password.js";

export const EvUsersService = {
    async getUser(userId: number): Promise<EvUser> {
        const user = await EvUsersRepository.getUser(userId);
        if (!user) {
            throw new HttpError(404, "Користувача не знайдено");
        }
        return user;
    },
    async deleteUser(userId: number): Promise<EvUser> {
        return await EvUsersRepository.deleteUser(userId);
    },
    async login(email: string, password: string): Promise<EvUser> {
        const user = await EvUsersRepository.findByEmail(email);
        if (!user) {
            throw new HttpError(401, "Невірний email або пароль");
        }
        const ok = verifyPassword(password, user.passwordHash);
        if (!ok) {
            throw new HttpError(401, "Невірний email або пароль");
        }
        return user;
    },
    async logout(userId: number): Promise<EvUser> {
        return await EvUsersRepository.logout(userId);
    },
    async register(user: EvUser): Promise<EvUser> {
        return await EvUsersRepository.register(user);
    },
}   