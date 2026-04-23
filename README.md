# Сервер (evCharging)

**Node.js** + **Express** + **Prisma**: REST API для бронювань, сесій зарядки, тарифів, користувачів і адміністративних сценаріїв. Підключається до PostgreSQL за `DATABASE_URL`.

## Запуск

```bash
npm install
npx prisma generate
npm run dev
```

Схема БД і SQL-скрипти — у [`../db/`](../db/). Додаткова документація — у [`../docs/`](../docs/).

## Аналітика адміна станцій

- SQL: [`SQL_scripts/functions/Station_admin_analytics.sql`](SQL_scripts/functions/Station_admin_analytics.sql)
- API: `GET /api/admin/analytics/views?stationId=<id>` (опційно; без параметра — мережеві KPI за 30 днів)
- Порядок скриптів: [`SQL_scripts/functions/ORDER.txt`](SQL_scripts/functions/ORDER.txt)

## Аналітика глобального адміна (ADMIN)

- **SQL (функції, 30 днів):** [`SQL_scripts/functions/Global_admin_analytics.sql`](SQL_scripts/functions/Global_admin_analytics.sql)  
  Сесії (кількість, середня тривалість, середній kWh, виручка, середній чек), виручка **по станціях і по портах**, **пікові години** (день тижня × година), **денна динаміка** виручки/kWh, **проксі день/ніч** тарифу (за годиною старту сесії), **гарячі міста** (навантаження), метрики **зв’язку бронювань і сесій** (конверсія).
- **SQL (мережа + опційно станція):** [`Station_admin_analytics.sql`](SQL_scripts/functions/Station_admin_analytics.sql) — KPI бронювань, ТОП / «анти-ТОП» станцій за сесіями; у відповіді API поле `stationAdminSnapshot`.
- **SQL VIEW:** [`SQL_scripts/View.sql`](SQL_scripts/View.sql) — глобальний дашборд, міста, сегменти користувачів, активні сесії тощо.
- **API:** `GET /api/admin/analytics/views` — усі VIEW + `stationAdminSnapshot` + **`globalAdminSnapshot`**; опційно `?stationId=` для деталізації по станції.
- **API:** `GET /api/admin/dashboard` — короткий зріз мережі (Prisma).
- Порядок SQL-файлів: [`SQL_scripts/functions/ORDER.txt`](SQL_scripts/functions/ORDER.txt).
- Ролі та доступ: [`README_ROLES.md`](../README_ROLES.md).
