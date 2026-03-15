import config from "./config";

export const setPrompt = (prompt: string): void => {
  config.setPrompt(prompt);
};

export const getPrompt = (): string => {
  return config.getPrompt();
};

export const clearPrompt = (): { cleared: boolean } => {
  const existing = config.getPrompt();
  if (!existing) return { cleared: false };
  config.clearPrompt();
  return { cleared: true };
};

export const hasPrompt = (): boolean => {
  return !!config.getPrompt();
};
