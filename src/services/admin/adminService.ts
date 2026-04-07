import { adminRepository, type EvUserPublicRow } from "../../db/admin/adminRepository.js";
import type { EvUser } from "../../../generated/prisma/index.js";
import {
    mapEvUserDetailToDto,
    type AdminEndUserDto,
} from "./adminUserDetailMapper.js";
import { userService } from "../user/userService.js";

export const adminService = {
    async getUsers(): Promise<EvUserPublicRow[]> {
        return await adminRepository.getUsers();
    },
    async getUser(userId: number): Promise<AdminEndUserDto> {
        const row = await adminRepository.getUserDetailForAdmin(userId);
        return mapEvUserDetailToDto(row);
    },
    async updateUser(userId: number, body: unknown): Promise<EvUser> {
        return await userService.updateProfileFromBody(userId, body);
    },
}   