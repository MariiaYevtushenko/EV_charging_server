import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Каталог `evCharging/forecast` (поруч із `server`). */
function forecastDir(): string {
  return path.resolve(__dirname, "..", "..", "..", "..", "forecast");
}

function runPython(scriptName: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = forecastDir();
  const script = path.join(dir, scriptName);
  const python = process.env["PYTHON_PATH"] ?? "python";
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script], {
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

export async function runUpdateBias(): Promise<{ code: number; stdout: string; stderr: string }> {
  return runPython("update_bias.py");
}
