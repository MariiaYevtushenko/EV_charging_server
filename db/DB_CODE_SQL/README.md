# Створення БД з нуля (`DB_CODE_SQL`)

Скрипти в цій папці призначені для **ручного** розгортання схеми PostgreSQL (без Prisma Migrate). Виконуйте їх **в одній базі**, у вказаному порядку — наступні кроки залежать від попередніх.

## Порядок виконання

| № | Файл | Призначення |
|---|------|--------------|
| 1 | `Database_evCharging.sql` | Типи (`ENUM`), таблиці, зовнішні ключі — **основа схеми**. |
| 2 | `Functions_Procuderus.sql` | Функції тарифу/білінгу, процедури (`CreateFinalBill`, `EndSession`, …), слоти бронювання. **Потрібно до тригерів**, бо тригери викликають `CreateFinalBill`. |
| 3 | `Functions_Analitics.sql` | Функції аналітики (мережа, станція, бронювання за період тощо). Залежать лише від таблиць і типів з п. 1. |
| 4 | `View.sql` | Представлення (`VIEW`). Частина з них викликає функції з **п. 3** (наприклад, `getadminsessionstatsbybookingkindforperiod`), тому **після** `Functions_Analitics.sql`. |
| 5 | `Triggers.sql` | Тригери на `session`, `station`, `booking`. Потребують процедур і типів з **п. 1–2**. |
| 6 | `Indexes.sql` | Індекси для прискорення запитів. Можна після таблиць; зручно **після тригерів**, перед наповненням даними. |
| 7 | `SeedData.sql` | Тестові / початкові дані. **Останнім**, коли схема, функції, VIEW і тригери вже створені. |

## Приклад (psql)

Створіть базу та користувача зазвичай окремо, потім:

```bash
psql -U postgres -d ev_charging -v ON_ERROR_STOP=1 -f Database_evCharging.sql
psql -U postgres -d ev_charging -v ON_ERROR_STOP=1 -f Functions_Procuderus.sql
psql -U postgres -d ev_charging -v ON_ERROR_STOP=1 -f Functions_Analitics.sql
psql -U postgres -d ev_charging -v ON_ERROR_STOP=1 -f View.sql
psql -U postgres -d ev_charging -v ON_ERROR_STOP=1 -f Triggers.sql
psql -U postgres -d ev_charging -v ON_ERROR_STOP=1 -f Indexes.sql
psql -U postgres -d ev_charging -v ON_ERROR_STOP=1 -f SeedData.sql
```

(`-v ON_ERROR_STOP=1` зупинить виконання при першій помилці.)

## Важливо

- **Prisma:** якщо основна схема ведеться через `prisma migrate`, переконайтеся, що вона **узгоджена** з `Database_evCharging.sql` (імена таблиць, `ENUM`, обов’язкові поля). Інакше дублювання або розбіжності дадуть помилки при накаті.
- **Повторний накат:** `CREATE OR REPLACE` у функціях і `VIEW` дозволяє перезапускати відповідні файли; для «чистої» БД спочатку видаліть об’єкти або створіть нову базу.
- Якщо після накату застосунок пише, що **функції не існують** (наприклад, `getstationsessionstatsforperiod`), зазвичай **не виконано** крок **3** або підключення йде до **іншої** бази, ніж та, куди накатували скрипти.

## Оновлення вже існуючої БД (`booking_status`)

Якщо раніше існував `NO_ACTION` і його прибрали з переліку — спочатку оновіть/перемапте дані, потім пересоздайте тип або використайте окрему міграцію Prisma.

Якщо в enum ще є значення `PAID` для бронювань, а схема його більше не використовує — оновіть рядки `booking.status` (наприклад, на `COMPLETED`) і приберіть значення з типу окремою міграцією PostgreSQL (видалення значення з `ENUM` потребує пересоздання типу або обхідного шляху).
