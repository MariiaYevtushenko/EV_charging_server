import type { Request, RequestHandler } from "express";
import { adminService } from "../../services/admin/adminService.js";
import { toEvUserPublic } from "../../utils/evUserPublic.js";

export const getUsers: RequestHandler = async (req, res, next) => {
    try {
        const users = await adminService.getUsers();
        res.json(users);
    }
    catch (e) {
        next(e);
    }
};

export const getUser: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const user = await adminService.getUser(userId);
        res.json(user);
    }
    catch (e) {
        next(e);
    }
};

export const updateUser: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const user = await adminService.updateUser(userId, req.body);
        res.json(toEvUserPublic(user));
    }
    catch (e) {
        next(e);
    }
};