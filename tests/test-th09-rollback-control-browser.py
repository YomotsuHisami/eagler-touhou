"""TH09 React entry for the shared local-Relay timing-control gate; no gameplay claim."""
from pathlib import Path
import importlib.util

spec = importlib.util.spec_from_file_location(
    "adonis_room_controls", Path(__file__).with_name("test-adonis-rollback-control-browser.py"))
suite = importlib.util.module_from_spec(spec)
spec.loader.exec_module(suite)


def main() -> None:
    suite.main(default_game="th09")


if __name__ == "__main__":
    main()
