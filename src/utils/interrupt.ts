type InterruptHandler = (signal: NodeJS.Signals) => void;

let activeHandler: InterruptHandler | undefined;
let afterCleanup: (() => void) | undefined;

/** Let a foreground operation finish cancellation and cleanup before exiting. */
export const dispatchInterrupt = (
  signal: NodeJS.Signals,
  onCleanup?: () => void,
): boolean => {
  if (!activeHandler) return false;
  afterCleanup ??= onCleanup;
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
    // Nested operations may finish before their caller's cleanup (e.g. editor
    // exit precedes temporary-file removal). Shut down only at the outer scope.
    if (!activeHandler) {
      const onCleanup = afterCleanup;
      afterCleanup = undefined;
      onCleanup?.();
    }
  }
};
