import type { PrismaClient } from "../../../generated/prisma/index.js";

/** `CancelBooking` у `Functions_Procuderus.sql`. */
export async function callCancelBooking(dbLike: Pick<PrismaClient, "$executeRaw">, bookingId: number): Promise<void> {
  await dbLike.$executeRaw`CALL cancelbooking(${bookingId}::int)`;
}

/** `CreateFinalBill` у `Functions_Procuderus.sql` (після COMPLETED сесії). */
export async function callCreateFinalBillPending(
  dbLike: Pick<PrismaClient, "$executeRawUnsafe">,
  sessionId: number
): Promise<void> {
  await dbLike.$executeRawUnsafe(`CALL createfinalbill($1::int, 'PENDING'::payment_status)`, sessionId);
}
