import chalk from 'chalk';

let verboseEnabled = false;

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface Spinner {
  update(msg: string): void;
  stop(): void;
}

export function createSpinner(message: string): Spinner {
  let frameIndex = 0;
  let currentMsg = message;

  const write = () => {
    const frame = chalk.cyan(SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length]);
    process.stdout.write(`\r${frame} ${currentMsg}`);
    frameIndex++;
  };

  write();
  const interval = setInterval(write, 80);

  return {
    update(msg: string) {
      currentMsg = msg;
    },
    stop() {
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(currentMsg.length + 4) + '\r');
    },
  };
}

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
