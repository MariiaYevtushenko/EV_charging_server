import "dotenv/config";
import { createApp } from "./app.js";
import { startForecastModelScheduler } from "./services/forecast/forecastScheduler.js";

const port = Number(process.env["PORT"]) || 3001;

const app = createApp();
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  startForecastModelScheduler();
});
