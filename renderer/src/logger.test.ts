import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FileLogger } from "../../electron/logger";

const temporaryDirectories: string[] = [];

function tempDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sport-coach-log-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("FileLogger", () => {
  it("records structured values and error stacks", () => {
    const logger = new FileLogger(tempDirectory());
    logger.write("INFO", "started", { version: 1 });
    logger.write("ERROR", new Error("boom"));
    const contents = fs.readFileSync(logger.filePath, "utf8");
    expect(contents).toContain("[INFO] started { version: 1 }");
    expect(contents).toContain("[ERROR] Error: boom");
  });

  it("rotates a full log and retains one previous file", () => {
    const directory = tempDirectory();
    const current = path.join(directory, "main.log");
    fs.writeFileSync(current, "12345678", "utf8");
    const logger = new FileLogger(directory, 8);
    expect(fs.readFileSync(logger.previousFilePath, "utf8")).toBe("12345678");
    logger.write("WARN", "new session");
    expect(fs.readFileSync(logger.filePath, "utf8")).toContain("new session");
  });
});
