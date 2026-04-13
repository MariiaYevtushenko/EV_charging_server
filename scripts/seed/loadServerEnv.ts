/**
 * Завантажує `server/.env` незалежно від process.cwd() (корінь репо, IDE тощо).
 * Імпортувати першим у seed-скриптах перед модулями, що читають process.env.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", "..", ".env");
// override: true — інакше порожні TARIFF_* з системного env не перезапишуться з server/.env
dotenv.config({ path: envPath, override: true });
