import { Router } from "express";
import { getUser, updateUser, changePassword, getVehicles, getVehicle, getVehicleAggregates, updateVehicle, addVehicle, getBookings, getBooking, createBooking, updateBooking, deleteBooking, getSessions, getSession, createSession, updateSession, completeSession, getPayments, getPayment, updatePayment, postPayBill, getUserAnalytics } from "../../controllers/user/userController.js";

export const evUserRouter = Router();

evUserRouter.post("/:userId/change-password", changePassword);
evUserRouter.get("/:userId/analytics/views", getUserAnalytics);
evUserRouter.get("/:userId", getUser);
evUserRouter.put("/:userId", updateUser);

evUserRouter.get("/:userId/vehicles", getVehicles);
evUserRouter.get("/:userId/vehicle/:vehicleId/stats", getVehicleAggregates);
evUserRouter.get("/:userId/vehicle/:vehicleId", getVehicle);
evUserRouter.put("/:userId/vehicle/:vehicleId", updateVehicle);
evUserRouter.post("/:userId/vehicle", addVehicle);

evUserRouter.get("/:userId/bookings", getBookings);
evUserRouter.get("/:userId/bookings/:bookingId", getBooking);
evUserRouter.post("/:userId/bookings", createBooking);
evUserRouter.put("/:userId/bookings/:bookingId", updateBooking);
evUserRouter.delete("/:userId/bookings/:bookingId", deleteBooking);


evUserRouter.get("/:userId/sessions", getSessions);
evUserRouter.get("/:userId/sessions/:sessionId", getSession);
evUserRouter.post("/:userId/sessions", createSession);
evUserRouter.post("/:userId/sessions/:sessionId/complete", completeSession);
evUserRouter.put("/:userId/sessions/:sessionId", updateSession);

evUserRouter.get("/:userId/payments", getPayments);
evUserRouter.post("/:userId/payments/:paymentId/pay", postPayBill);
evUserRouter.get("/:userId/payments/:paymentId", getPayment);
evUserRouter.put("/:userId/payments/:paymentId", updatePayment);
