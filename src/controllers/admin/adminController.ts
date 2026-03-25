import type { Request, RequestHandler } from "express";
import { userService } from "../services/userService.js";


export const getUsers: RequestHandler = async (req, res, next) => {
    try {
        const users = await userService.getUsers();
        res.json(users);
    }
    catch (e) {
        next(e);
    }
};

export const getUser: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const user = await userService.getUser(userId);
        res.json(user);
    }
    catch (e) {
        next(e);
    }
};

export const updateUser: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const user = await userService.updateUser(userId, req.body);
        res.json(user);
    }
    catch (e) {
        next(e);
    }
};