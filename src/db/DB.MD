Тільки чисті запити Prisma (findUnique, create, update).
Виклики Stored Procedures ($queryRaw).


npx prisma generate
npx prisma migrate dev --name init
npx prisma db push

npx prisma migrate dev --name added_new_field.


Як «виправити»: додати моделі в prisma/schema.prisma, потім:
cd server
npx prisma generate
npx prisma migrate dev --name init