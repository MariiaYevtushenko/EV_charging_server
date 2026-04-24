import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Каталог `evCharging/forecast` (поруч із `server`). */
function forecastDir(): string {
  return path.resolve(__dirname, "..", "..", "..", "..", "forecast");
}

/**
 * Запуск інтерпретатора для `scriptAbsPath`.
 * На Windows `python` часто відсутній у PATH (cmd повертає **9009**) — за замовчуванням `py -3`.
 * Явний шлях: `PYTHON_PATH=C:\\...\\python.exe` (або `python`, якщо він у PATH).
 */
function pythonSpawnConfig(scriptAbsPath: string): { command: string; args: string[] } {
  const custom = process.env["PYTHON_PATH"]?.trim();
  if (custom) {
    return { command: custom, args: [scriptAbsPath] };
  }
  if (process.platform === "win32") {
    return { command: "py", args: ["-3", scriptAbsPath] };
  }
  return { command: "python3", args: [scriptAbsPath] };
}

function runPython(scriptName: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = forecastDir();
  const script = path.join(dir, scriptName);
  const { command, args } = pythonSpawnConfig(script);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: dir,
      env: { ...process.env },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c) => {
      stdout += String(c);
    });
    child.stderr?.on("data", (c) => {
      stderr += String(c);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function runAiEngine(): Promise<{ code: number; stdout: string; stderr: string }> {
  return runPython("ai_engine.py");
}
