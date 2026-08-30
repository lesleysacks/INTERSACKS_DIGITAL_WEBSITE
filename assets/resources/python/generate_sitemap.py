from argparse import ArgumentParser
from datetime import date
from pathlib import Path
from urllib.parse import quote
from xml.sax.saxutils import escape


def page_url(path: Path, root: Path, base_url: str) -> str:
    relative = path.relative_to(root).as_posix()
    route = relative[:-10] if relative.endswith("index.html") else relative
    return f"{base_url.rstrip('/')}/{quote(route, safe='/')}"


def build_sitemap(root: Path, base_url: str) -> str:
    pages = sorted(p for p in root.rglob("*.html") if "404" not in p.stem)
    today = date.today().isoformat()
    entries = [
        f"  <url><loc>{escape(page_url(page, root, base_url))}</loc><lastmod>{today}</lastmod></url>"
        for page in pages
    ]
    return "\n".join([
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        *entries,
        "</urlset>",
        "",
    ])


if __name__ == "__main__":
    parser = ArgumentParser(description="Generate sitemap.xml for a static site.")
    parser.add_argument("base_url", help="Example: https://example.com")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    output = args.root / "sitemap.xml"
    output.write_text(build_sitemap(args.root, args.base_url), encoding="utf-8")
    print(f"Created {output.resolve()}")
