import * as fs from "fs";
import * as path from "path";
import { inspect } from "util";

export type LogLevel = "INFO" | "WARN" | "ERROR";

function formatValue(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  return inspect(value, { depth: 5, breakLength: 160 });
}

/** Small synchronous logger for the Electron main process. Main-process events
 * are low volume, and synchronous append ensures the last crash line reaches
 * disk before the process exits. One previous file is retained to cap growth. */
export class FileLogger {
  readonly filePath: string;
  readonly previousFilePath: string;

  constructor(
    logDirectory: string,
    private readonly maxBytes = 1024 * 1024,
  ) {
    this.filePath = path.join(logDirectory, "main.log");
    this.previousFilePath = path.join(logDirectory, "main.previous.log");
    fs.mkdirSync(logDirectory, { recursive: true });
    this.rotateIfNeeded();
  }

  private rotateIfNeeded(): void {
    let size = 0;
    try {
      size = fs.statSync(this.filePath).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (size < this.maxBytes) return;
    fs.rmSync(this.previousFilePath, { force: true });
    fs.renameSync(this.filePath, this.previousFilePath);
  }

  write(level: LogLevel, ...values: unknown[]): void {
    const line = `${new Date().toISOString()} [${level}] ${values
      .map(formatValue)
      .join(" ")}\n`;
    try {
      fs.appendFileSync(this.filePath, line, "utf8");
    } catch (error) {
      // Logging must never crash the app while handling another failure.
      process.stderr.write(`Could not write main-process log: ${formatValue(error)}\n`);
    }
  }
}

let mainLogger: FileLogger | undefined;

export function initializeMainLogger(logDirectory: string): string {
  mainLogger = new FileLogger(logDirectory);
  mainLogger.write("INFO", "Main-process logging initialized");
  return mainLogger.filePath;
}

function write(level: LogLevel, ...values: unknown[]): void {
  if (mainLogger) {
    mainLogger.write(level, ...values);
    return;
  }
  const text = values.map(formatValue).join(" ");
  if (level === "ERROR") console.error(text);
  else if (level === "WARN") console.warn(text);
  else console.info(text);
}

export const logInfo = (...values: unknown[]): void => write("INFO", ...values);
export const logWarn = (...values: unknown[]): void => write("WARN", ...values);
export const logError = (...values: unknown[]): void => write("ERROR", ...values);
