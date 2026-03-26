import config from "./config";

const instructions: Record<string, string> = {
  bash: 'Add to ~/.bashrc:   eval "$(gsmart completions bash)"',
  zsh: 'Add to ~/.zshrc:    eval "$(gsmart completions zsh)"',
  fish: "Run:  gsmart completions fish > ~/.config/fish/completions/gsmart.fish",
};

/**
 * Show a welcome message with shell completion instructions on first run.
 * After the message is displayed once, it is suppressed on subsequent runs.
 */
export function showWelcomeOnce(shell?: string): void {
  if (config.getWelcomeShown()) {
    return;
  }

  const shellName = shell ? shell.split("/").pop() : undefined;
  const command = shellName ? instructions[shellName] : undefined;

  if (command) {
    console.log(`
  GSmart installed successfully!

  Enable ${shellName} completions for tab autocompletion:

    ${command}
`);
  } else {
    console.log(`
  GSmart installed successfully!

  Enable shell completions for tab autocompletion:

    ${instructions.bash}
    ${instructions.zsh}
    ${instructions.fish}
`);
  }

  config.setWelcomeShown(true);
}
