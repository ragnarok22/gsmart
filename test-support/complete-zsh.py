"""Exercise generated completion through ZLE in a real pseudo-terminal."""

import errno
import json
import os
from pathlib import Path
import select
import shlex
import signal
import sys
import tempfile
import time


request = json.load(sys.stdin)
with tempfile.TemporaryDirectory(prefix="gsmart-zle-") as directory:
    script = Path(directory, "completion.zsh")
    matches = Path(directory, "matches")
    script.write_text(
        "autoload -Uz compinit\ncompinit -D\n"
        + request["script"]
        + r'''
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
        wait_for(b"GSMART_COMPLETION_DONE")
        result = matches.read_text().splitlines() if matches.exists() else []
        print(json.dumps(list(dict.fromkeys(result))))
    finally:
        os.kill(pid, signal.SIGTERM)
        os.close(terminal)
        os.waitpid(pid, 0)
