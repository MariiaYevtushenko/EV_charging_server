import type { Request, RequestHandler } from "express";
import { EvUsersService } from "../services/EvUsersService.js";

export const getUser: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        if (!userId) {
            res.status(400).json({ error: "User id is required" });
            return;
        }
        const user = await EvUsersService.getUser(userId);
        res.json(user);
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
        const user = await EvUsersService.updateUser(userId, req.body);
        res.json(user);
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
        res.json(user);

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