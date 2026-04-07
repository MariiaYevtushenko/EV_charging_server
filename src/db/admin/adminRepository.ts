import prisma from "../../prisma.config.js";
import type { PrismaClient, UserRole } from "../../../generated/prisma/index.js";
import { adminUserDetailInclude } from "../../services/admin/adminUserDetailMapper.js";

const db = prisma as unknown as PrismaClient;

/** Поля ev_user без password_hash (для списку в адмінці). */
export type EvUserPublicRow = {
  id: number;
  name: string;
  surname: string;
  email: string;
  phoneNumber: string;
  role: UserRole;
  createdAt: Date;
};

export const adminRepository = {
  async getUsers(): Promise<EvUserPublicRow[]> {
    return await db.evUser.findMany({
      select: {
        id: true,
        name: true,
        surname: true,
        email: true,
        phoneNumber: true,
        role: true,
        createdAt: true,
      },
      orderBy: { id: "asc" },
    });
  },

  async getUserDetailForAdmin(userId: number) {
    return await db.evUser.findUniqueOrThrow({
      where: { id: userId },
      include: adminUserDetailInclude,
    });
  },
};
