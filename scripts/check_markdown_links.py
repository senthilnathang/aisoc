#!/usr/bin/env python3
"""Check repository-relative inline Markdown links in maintained documentation."""
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


def main():
    documents = {ROOT / "README.md", ROOT / "backend-go/README.md"}
    for directory in ("docs", "tests", "services", "deploy"):
        documents.update(p for p in (ROOT / directory).rglob("*.md")
                         if not any(part in ("target", ".venv", "node_modules") for part in p.parts))
    failures = []
    checked = 0
    for path in sorted(documents):
        text = re.sub(r"```.*?```|~~~.*?~~~", "", path.read_text(), flags=re.S)
        for match in re.finditer(r"\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+\"[^\"]*\")?\)", text):
            link = match.group(1).strip("<>")
            parsed = urlsplit(link)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            target = (path.parent / unquote(parsed.path)).resolve()
            # Generated receipts/private runtime files are intentionally absent
            # in fresh checkouts; check source links, not local evidence retention.
            if target.is_relative_to(ROOT / "output") or target.is_relative_to(ROOT / ".run"):
                continue
            checked += 1
            if not target.exists():
                failures.append(f"{path.relative_to(ROOT)}: missing {link}")
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print(f"PASS: {checked} relative file links across {len(documents)} Markdown documents")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
