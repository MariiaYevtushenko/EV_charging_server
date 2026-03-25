import { Router } from "express";
import { getUser, updateUser, deleteUser, login, logout, register } from "../controllers/userController.js";


export const usersRouter = Router();


usersRouter.get("/:userId", getUser);
usersRouter.put("/:userId", updateUser);
usersRouter.delete("/:userId", deleteUser);

usersRouter.post("/login", login);
usersRouter.post("/logout", logout);
usersRouter.post("/register", register);
