import { EvUsersRepository } from "../../db/EvUserRepository.js";
import { adminRepository } from "../../db/admin/adminRepository.js";
import type { EvUser } from "../../../generated/prisma/index.js";

export const adminService = {
    async getUsers(): Promise<EvUser[]> {
        return await adminRepository.getUsers();
    },
    async getUser(userId: number): Promise<EvUser> {
        return await EvUsersRepository.getUser(userId);
    },
    async updateUser(userId: number, user: EvUser): Promise<EvUser> {
        return await EvUsersRepository.updateUser(userId, user);
    },
}   