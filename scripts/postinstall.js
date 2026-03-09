#!/usr/bin/env node

const shell = (process.env.SHELL || "").split("/").pop();

const instructions = {
  bash: 'Add to ~/.bashrc:   eval "$(gsmart completions bash)"',
  zsh: 'Add to ~/.zshrc:    eval "$(gsmart completions zsh)"',
  fish: "Run:  gsmart completions fish > ~/.config/fish/completions/gsmart.fish",
};

const command = instructions[shell];

if (command) {
  console.log(`
  ✨ GSmart installed successfully!

  Enable ${shell} completions for tab autocompletion:

    ${command}
`);
} else {
  console.log(`
  ✨ GSmart installed successfully!

  Enable shell completions for tab autocompletion:

    ${instructions.bash}
    ${instructions.zsh}
    ${instructions.fish}
`);
}
