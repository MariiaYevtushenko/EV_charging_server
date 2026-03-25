import { Router } from "express";
import { getUsers, getUser, updateUser } from "../../controllers/admin/adminController.js";

export const adminRouter = Router();

adminRouter.get("/users", getUsers);
adminRouter.get("/users/:userId", getUser);
adminRouter.put("/users/:userId", updateUser);

