import chalk from 'chalk';

let verboseEnabled = false;

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

export function isVerbose(): boolean {
  return verboseEnabled;
}

export const logger = {
  info(msg: string) {
    console.log(chalk.blue('ℹ'), msg);
  },
  success(msg: string) {
    console.log(chalk.green('✓'), msg);
  },
  warn(msg: string) {
    console.log(chalk.yellow('⚠'), msg);
  },
  error(msg: string) {
    console.error(chalk.red('✗'), msg);
  },
  heading(msg: string) {
    console.log(chalk.bold.cyan(`\n${msg}`));
  },
  dim(msg: string) {
    console.log(chalk.dim(msg));
  },
  debug(msg: string) {
    if (verboseEnabled) {
      console.log(chalk.gray(`[DEBUG] ${msg}`));
    }
  },
};
