import { PassThrough } from "node:stream";
import type { FactoryResult } from "@software-factory/core";
import type Docker from "dockerode";
import { err, ok } from "neverthrow";

export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface ExecOptions {
  readonly env?: readonly string[];
  readonly workingDir?: string;
  readonly timeoutMs?: number;
}

export async function execInContainer(
  docker: Docker,
  containerId: string,
  cmd: readonly string[],
  options: ExecOptions,
): Promise<FactoryResult<ExecResult>> {
  const start = Date.now();
  try {
    const container = docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: [...cmd],
      Env: options.env ? [...options.env] : undefined,
      WorkingDir: options.workingDir ?? "/workspace",
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    const stdoutBuf = new PassThrough();
    const stderrBuf = new PassThrough();

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    stdoutBuf.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    stderrBuf.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    docker.modem.demuxStream(stream, stdoutBuf, stderrBuf);

    await new Promise<void>((resolve, reject) => {
      const timeout = options.timeoutMs;
      let timer: ReturnType<typeof setTimeout> | undefined;

      if (timeout) {
        timer = setTimeout(() => {
          stream.destroy();
          reject(new Error(`Exec timed out after ${timeout}ms`));
        }, timeout);
      }

      stream.on("end", () => {
        if (timer) clearTimeout(timer);
        stdoutBuf.end();
        stderrBuf.end();
        resolve();
      });

      stream.on("error", (e: Error) => {
        if (timer) clearTimeout(timer);
        reject(e);
      });
    });

    const inspection = await exec.inspect();
    const exitCode = inspection.ExitCode ?? -1;

    return ok({
      exitCode,
      stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
      stderr: Buffer.concat(stderrChunks).toString("utf-8"),
      durationMs: Date.now() - start,
    });
  } catch (error) {
    return err({
      code: "sandbox_failure" as const,
      message: `Exec failed: ${error instanceof Error ? error.message : String(error)}`,
      retryable: false,
    });
  }
}
