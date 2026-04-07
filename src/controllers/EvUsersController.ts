import type { RequestHandler } from "express";
import { EvUsersService } from "../services/EvUsersService.js";
import { userService } from "../services/user/userService.js";
import { toEvUserPublic } from "../utils/evUserPublic.js";

export const getUser: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        if (!userId) {
            res.status(400).json({ error: "User id is required" });
            return;
        }
        const user = await EvUsersService.getUser(userId);
        res.json(toEvUserPublic(user));
    }
    catch (e) {
        next(e);
    }
};

export const updateUser: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        if (!userId) {
            res.status(400).json({ error: "User id is required" });
            return;
        }
        const user = await userService.updateProfileFromBody(userId, req.body);
        res.json(toEvUserPublic(user));
    }
    catch (e) {
        next(e);
    }
};

export const login: RequestHandler = async (req, res, next) => {
    try {
        const email = req.body["email"];
        const password = req.body["password"];
        if (!email || !password) {
            res.status(400).json({ error: "Email and password are required" });
            return;
        }
        const user = await EvUsersService.login(email, password);
        const { passwordHash: _p, ...safe } = user;
        res.json(safe);

    }
    catch (e) {
        next(e);
    }
};

export const register: RequestHandler = async (req, res, next) => {
    try {
        const email = req.body["email"];
        const password = req.body["password"];
        if (!email || !password) {
            res.status(400).json({ error: "Email and password are required" });
            return;
        }
        const user = await EvUsersService.register(req.body);
        res.json(user);
    }
    catch (e) {
        next(e);
    }
};

export const logout: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        if (!userId) {
            res.status(400).json({ error: "User id is required" });
            return;
        }
        const user = await EvUsersService.logout(userId);
        res.json(user);
    }
    catch (e) {
        next(e);
    }
};

export const deleteUser: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        if (!userId) {
            res.status(400).json({ error: "User id is required" });
            return;
        }
        const user = await EvUsersService.deleteUser(userId);
        res.json(user);
    }
    catch (e) {
        next(e);
    }
};