"""Exercise generated completion through ZLE in a real pseudo-terminal."""

import errno
import fcntl
import json
import os
from pathlib import Path
import select
import shlex
import signal
import struct
import sys
import tempfile
import termios
import time


request = json.load(sys.stdin)
display = request.get("display", False)
with tempfile.TemporaryDirectory(prefix="gsmart-zle-") as directory:
    script = Path(directory, "completion.zsh")
    matches = Path(directory, "matches")
    capture_widget = r'''
compadd() {
    # Let native compadd filter by the actual cursor prefix. Ignore internal
    # probes which ask compadd to populate arrays instead of adding matches.
    if [[ ${@[(I)-[ADO]]} == 0 ]]; then
        local -a captured
        builtin compadd -A captured "$@"
        if (($#captured)); then
            print -rC1 -- "${(@Q)captured}" >> "$GSMART_MATCHES"
        fi
    fi
    builtin compadd "$@"
}
_gsmart_test_complete() {
    _main_complete
    print -r -- GSMART_COMPLETION_DONE
}
zle -C gsmart-test complete-word _gsmart_test_complete
'''
    script.write_text(
        "autoload -Uz compinit\ncompinit -D\n"
        + request["script"]
        + ("\nzle -C gsmart-test list-choices _main_complete\n" if display else capture_widget)
        + r'''
bindkey '^X' gsmart-test
PS1='gsmart-test> '
print -r -- GSMART_COMPLETION_READY
'''
    )
    pid, terminal = os.forkpty()
    if pid == 0:
        os.environ["GSMART_MATCHES"] = str(matches)
        os.environ["TERM"] = "xterm"
        os.environ["ZDOTDIR"] = directory
        os.execvp(request["shell"], [request["shell"], "-dfi"])

    fcntl.ioctl(
        terminal,
        termios.TIOCSWINSZ,
        struct.pack("HHHH", request.get("rows", 40), request.get("columns", 120), 0, 0),
    )

    def wait_for(marker):
        output = b""
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if select.select([terminal], [], [], 0.1)[0]:
                try:
                    chunk = os.read(terminal, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    break
                if not chunk:
                    break
                output += chunk
                if marker in output:
                    return
        raise RuntimeError("Zsh completion did not finish: " + repr(output))

    try:
        os.write(terminal, ("source " + shlex.quote(str(script)) + "\n").encode())
        wait_for(b"GSMART_COMPLETION_READY")
        os.write(terminal, request["line"].encode() + b"\x18")
        if display:
            # Capture native list rendering without intercepting compadd, which
            # would affect Zsh's grouped descriptions and hide display defects.
            screen = b""
            while select.select([terminal], [], [], 1)[0]:
                screen += os.read(terminal, 65536)
            print(json.dumps(screen.decode(errors="replace")))
        else:
            wait_for(b"GSMART_COMPLETION_DONE")
            result = matches.read_text().splitlines() if matches.exists() else []
            print(json.dumps(list(dict.fromkeys(result))))
    finally:
        os.kill(pid, signal.SIGTERM)
        os.close(terminal)
        os.waitpid(pid, 0)
