import sys

import httpx

from kolindex_discovery.discover import discover_accounts
from kolindex_discovery.query import InvalidQuery


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python -m kolindex_discovery <name-or-username>", file=sys.stderr)
        raise SystemExit(2)
    try:
        with httpx.Client(timeout=10.0, follow_redirects=False) as client:
            result = discover_accounts(sys.argv[1], client)
    except InvalidQuery as exc:
        print(exc, file=sys.stderr)
        raise SystemExit(2) from exc
    print(result.model_dump_json(indent=2))


if __name__ == "__main__":
    main()
