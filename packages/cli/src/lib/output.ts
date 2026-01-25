/**
 * Unified Output Handler
 *
 * Provides consistent output formatting for CLI commands.
 * Supports both human-readable and JSON output formats.
 */

import chalk from "chalk";

export type OutputFormat = "human" | "json";

export interface OutputOptions {
  format: OutputFormat;
}

/**
 * Generic output function that handles both human and JSON formats.
 *
 * @param data - The data to output
 * @param humanFormatter - Function to format data for human-readable output
 * @param options - Output options including format
 */
export function output<T>(
  data: T,
  humanFormatter: (data: T) => void,
  options: OutputOptions
): void {
  if (options.format === "json") {
    console.log(JSON.stringify(data, null, 2));
  } else {
    humanFormatter(data);
  }
}

/**
 * Output a success message.
 */
export function success(message: string, options: OutputOptions): void {
  if (options.format === "json") {
    console.log(JSON.stringify({ success: true, message }));
  } else {
    console.log(chalk.green(`✓ ${message}`));
  }
}

/**
 * Output an error message.
 */
export function error(message: string, options: OutputOptions): void {
  if (options.format === "json") {
    console.log(JSON.stringify({ success: false, error: message }));
  } else {
    console.error(chalk.red(`✗ ${message}`));
  }
}

/**
 * Output a warning message.
 */
export function warning(message: string, options: OutputOptions): void {
  if (options.format === "json") {
    console.log(JSON.stringify({ warning: message }));
  } else {
    console.log(chalk.yellow(`⚠ ${message}`));
  }
}

/**
 * Output an info message (only in human format, ignored in JSON).
 */
export function info(message: string, options: OutputOptions): void {
  if (options.format === "human") {
    console.log(chalk.dim(message));
  }
}

/**
 * Output a header/title (only in human format, ignored in JSON).
 */
export function header(message: string, options: OutputOptions): void {
  if (options.format === "human") {
    console.log(chalk.bold(message));
  }
}

/**
 * Output a blank line (only in human format, ignored in JSON).
 */
export function newline(options: OutputOptions): void {
  if (options.format === "human") {
    console.log();
  }
}

/**
 * Get default output options (human format).
 */
export function getDefaultOutputOptions(): OutputOptions {
  return { format: "human" };
}

/**
 * Parse format option from command line.
 */
export function parseFormatOption(format?: string | boolean): OutputFormat {
  if (format === "json" || format === true) {
    return "json";
  }
  return "human";
}


