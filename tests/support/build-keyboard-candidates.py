"""Incremental Issue 21 validation builds; does not edit baseline build trees.

Reuses baseline objects/assets, recompiles the changed Controller unit, and
links candidate shells plus validation-only probes. Not a clean/release build.
"""
import argparse
import json
from pathlib import Path
import shlex
import shutil
import subprocess


def arguments(command):
    return [arg.strip('"') for arg in shlex.split(command, posix=False)]


def build(game, baseline, candidate, ninja):
    source = baseline.parent
    output = candidate / "artifacts/validation/keyboard-ownership/runtime"
    output.mkdir(parents=True, exist_ok=True)
    commands = json.loads((baseline / "compile_commands.json").read_text(encoding="utf-8"))
    command = next(x["command"] for x in commands if x["file"].replace("\\", "/").endswith("/src/Controller.cpp"))
    compile_args = arguments(command)
    compile_args = [arg.replace((source / "src").as_posix(), (candidate / "src").as_posix()) for arg in compile_args]
    compile_args[-1] = str(candidate / "src/Controller.cpp")
    compile_args[compile_args.index("-o") + 1] = str(output / "Controller.cpp.o")
    print("COMPILE", game, flush=True)
    subprocess.run(compile_args, cwd=baseline, check=True)
    probe = Path(__file__).resolve().parents[1] / "fixtures/keyboard-ownership-probe.cpp"
    probe_args = list(compile_args)
    probe_args[-1] = str(probe)
    probe_args[probe_args.index("-o") + 1] = str(output / "keyboard-probe.o")
    subprocess.run(probe_args, cwd=baseline, check=True)
    lines = subprocess.check_output([ninja, "-t", "commands", game + ".html"], cwd=baseline, text=True).splitlines()
    link = next(line for line in reversed(lines) if " -o " + game + ".html" in line)
    # Invoke the compiler with structured arguments; do not execute Ninja's
    # Windows cmd wrapper or its trailing cd / shell separators.
    prefix, suffix = link.split("em++.exe", 1)
    executable = prefix.rsplit(" && ", 1)[-1].lstrip('"') + "em++.exe"
    link_args = [executable] + arguments(suffix.split(" && ", 1)[0].rstrip('"'))
    link_args[link_args.index("-o") + 1] = str(output / (game + ".html"))
    link_args[link_args.index("--shell-file") + 1] = str(candidate / "resources/shell.html")
    old_object = "CMakeFiles/" + game + ".dir/src/Controller.cpp.o"
    link_args = [str(output / "Controller.cpp.o") if arg.replace("\\", "/") == old_object else arg for arg in link_args]
    link_args.insert(link_args.index("-o"), str(output / "keyboard-probe.o"))
    print("LINK", game, flush=True)
    subprocess.run(link_args, cwd=baseline, check=True)
    (output / "incremental-build-evidence.json").write_text(json.dumps({
        "game": game, "baselineBuild": str(baseline), "candidateSource": str(candidate),
        "method": "recompile Controller; relink baseline objects with candidate shell and test-only probes",
        "compile": compile_args, "probeCompile": probe_args, "link": link_args,
    }, indent=2), encoding="utf-8")
    print("BUILT", game, flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--th06-baseline", type=Path, required=True)
    parser.add_argument("--th07-baseline", type=Path, required=True)
    parser.add_argument("--th06-candidate", type=Path, required=True)
    parser.add_argument("--th07-candidate", type=Path, required=True)
    parser.add_argument("--ninja", default=shutil.which("ninja"))
    args = parser.parse_args()
    if not args.ninja:
        parser.error("--ninja is required when Ninja is not on PATH")
    for game in ["th06", "th07"]:
        build(game, getattr(args, game + "_baseline").resolve(), getattr(args, game + "_candidate").resolve(), args.ninja)


if __name__ == "__main__":
    main()
