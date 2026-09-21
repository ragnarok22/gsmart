type InterruptHandler = (signal: NodeJS.Signals) => void;

let activeHandler: InterruptHandler | undefined;

/** Let a foreground operation finish cancellation and cleanup before exiting. */
export const dispatchInterrupt = (signal: NodeJS.Signals): boolean => {
  if (!activeHandler) return false;
  activeHandler(signal);
  return true;
};

export const withInterruptHandler = async <T>(
  handler: InterruptHandler,
  operation: () => Promise<T>,
): Promise<T> => {
  const previous = activeHandler;
  activeHandler = handler;
  try {
    return await operation();
  } finally {
    activeHandler = previous;
  }
};
