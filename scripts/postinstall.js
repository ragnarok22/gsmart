#!/usr/bin/env node

const message = `
  ✨ GSmart installed successfully!

  Enable shell completions for tab autocompletion:

    bash:  gsmart completions bash >> ~/.bashrc
    zsh:   gsmart completions zsh >> ~/.zshrc
    fish:  gsmart completions fish > ~/.config/fish/completions/gsmart.fish

  Then restart your shell or source the config file.
`;

console.log(message);
