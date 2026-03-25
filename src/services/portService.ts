import { portRepository } from "../db/portRepository.js";
import type { Port } from "../../generated/prisma/index.js";

export const portService = {
    async createPort( port: Port): Promise<Port> {
        return await portRepository.createPort(port);
    }
}