import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";

export type BackendEngineMode = "auto" | "opencv" | "magick";

export interface ProfessionalExportJob {
  inputPath: string;
  outputPath: string;
  mode: "mono" | "cmyk";
  lpi: number;
  angle: number;
  dpi: number;
  dot: "round" | "ellipse" | "line";
  contrast: number;
  brightness: number;
  transparent: boolean;
}

export interface ProfessionalExportResult {
  engineUsed: "opencv" | "magick";
}

const thresholdMaps = { round: "h8x8a", ellipse: "h4x4a", line: "h4x4o" } as const;

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `${command} exited with ${code}`));
    });
  });
}

async function runMagickPipeline(job: ProfessionalExportJob): Promise<void> {
  const map = job.lpi <= 30 ? "h16x16o" : thresholdMaps[job.dot];
  const colorspace = job.mode === "cmyk" ? "CMYK" : "Gray";
  const outputColorspace = job.mode === "cmyk" ? "sRGB" : "Gray";
  const args = [
    job.inputPath,
    "-auto-orient",
    "-alpha",
    "on",
    "-background",
    "none",
    "-colorspace",
    colorspace,
    "-brightness-contrast",
    `${job.brightness}x${job.contrast}`,
    "-virtual-pixel",
    "edge",
    "-distort",
    "SRT",
    String(job.angle),
    "-ordered-dither",
    map,
    "-colorspace",
    outputColorspace,
    "-density",
    String(job.dpi),
    "-units",
    "PixelsPerInch",
  ];
  if (job.transparent) args.push("-transparent", "white");
  args.push(`PNG32:${job.outputPath}`);
  await runCommand("magick", args);
}

async function runOpenCvPipeline(job: ProfessionalExportJob): Promise<void> {
  const externalCommand = process.env.HALFTONE_OPENCV_COMMAND;
  const externalArgs = (process.env.HALFTONE_OPENCV_ARGS || "").trim();
  const args = [
    "--input",
    job.inputPath,
    "--output",
    job.outputPath,
    "--mode",
    job.mode,
    "--lpi",
    String(job.lpi),
    "--angle",
    String(job.angle),
    "--dpi",
    String(job.dpi),
    "--dot",
    job.dot,
    "--contrast",
    String(job.contrast),
    "--brightness",
    String(job.brightness),
    "--transparent",
    String(job.transparent),
  ];
  if (externalCommand) {
    const commandArgs = externalArgs.length ? externalArgs.split(/\s+/) : [];
    await runCommand(externalCommand, [...commandArgs, ...args]);
    return;
  }

  const scriptPath = join(process.cwd(), "scripts", "opencv_halftone_worker.py");
  await access(scriptPath, fsConstants.F_OK);
  try {
    await runCommand("python", [scriptPath, ...args]);
    return;
  } catch {
    await runCommand("python3", [scriptPath, ...args]);
  }
}

function configuredMode(): BackendEngineMode {
  const envMode = (process.env.HALFTONE_BACKEND_ENGINE || "auto").toLowerCase();
  if (envMode === "opencv" || envMode === "magick" || envMode === "auto") return envMode;
  return "auto";
}

export async function runProfessionalExportWorker(job: ProfessionalExportJob): Promise<ProfessionalExportResult> {
  const mode = configuredMode();
  if (mode === "magick") {
    await runMagickPipeline(job);
    return { engineUsed: "magick" };
  }
  if (mode === "opencv") {
    await runOpenCvPipeline(job);
    return { engineUsed: "opencv" };
  }

  try {
    await runOpenCvPipeline(job);
    return { engineUsed: "opencv" };
  } catch {
    await runMagickPipeline(job);
    return { engineUsed: "magick" };
  }
}
