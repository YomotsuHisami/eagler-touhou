import argparse
import json
import os
import subprocess
import sys
import tempfile

from fontTools.ttLib import TTFont


def main():
    parser = argparse.ArgumentParser(description="Build an auditable Unicode font subset")
    parser.add_argument("font")
    parser.add_argument("--text-file", required=True)
    parser.add_argument("--output-file", required=True)
    args = parser.parse_args()

    with open(args.text_file, "r", encoding="utf-8") as source:
        requested = set(source.read())
    font = TTFont(args.font, lazy=True)
    cmap = set()
    for table in font["cmap"].tables:
        cmap.update(table.cmap)
    font.close()
    supported = sorted(character for character in requested if ord(character) in cmap)
    fallback = sorted(ord(character) for character in requested if ord(character) not in cmap)

    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", delete=False) as output:
            output.write("".join(supported))
            temporary = output.name
        subprocess.run([
            sys.executable, "-m", "fontTools.subset", args.font,
            f"--text-file={temporary}", f"--output-file={args.output_file}",
            "--layout-features=*", "--name-IDs=*", "--name-legacy", "--name-languages=*",
            "--notdef-glyph", "--notdef-outline", "--recommended-glyphs",
            "--no-ignore-missing-unicodes",
            # GNU Unifont covers newer Unicode-range bits than older FontTools'
            # OS/2 range validator accepts.  Subsetting does not need to rewrite
            # those metadata bits; keep the source declaration and only subset
            # cmap/glyph data.
            "--no-prune-unicode-ranges",
        ], check=True)
    finally:
        if temporary:
            os.unlink(temporary)

    print(json.dumps({
        "requested": len(requested),
        "included": len(supported),
        "fallback": [f"U+{codepoint:04X}" for codepoint in fallback],
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
