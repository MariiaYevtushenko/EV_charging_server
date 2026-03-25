import { EvUsersRepository } from "../db/EvUserRepository.js";
import type { EvUser } from "../../generated/prisma/index.js";

export const EvUsersService = {
    async getUser(userId: number): Promise<EvUser> {
        return await EvUsersRepository.getUser(userId);
    },
    async updateUser(userId: number, user: EvUser): Promise<EvUser> {
        return await EvUsersRepository.updateUser(userId, user);
    },
    async deleteUser(userId: number): Promise<EvUser> {
        return await EvUsersRepository.deleteUser(userId);
    },
    async login(email: string, password: string): Promise<EvUser> {
        return await EvUsersRepository.login(email, password);
    },
    async logout(userId: number): Promise<EvUser> {
        return await EvUsersRepository.logout(userId);
    },
    async register(user: EvUser): Promise<EvUser> {
        return await EvUsersRepository.register(user);
    },
}   