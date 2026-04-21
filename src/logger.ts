export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error?(message: string): void;
}

export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};

export const consoleLogger: Logger = {
  info(message: string) {
    console.log(message);
  },
  warn(message: string) {
    console.warn(message);
  },
  error(message: string) {
    console.error(message);
  },
};
