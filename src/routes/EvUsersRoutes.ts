import { Router } from "express";
import { getUser, updateUser, deleteUser, login, logout, register } from "../controllers/EvUsersController.js";


export const EvUsersRouter = Router();


EvUsersRouter.get("/:userId", getUser);
EvUsersRouter.put("/:userId", updateUser);
EvUsersRouter.delete("/:userId", deleteUser);

EvUsersRouter.post("/login", login);
EvUsersRouter.post("/logout", logout);
EvUsersRouter.post("/register", register);
