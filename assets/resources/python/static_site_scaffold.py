from argparse import ArgumentParser
from pathlib import Path
import re


def safe_name(value: str) -> str:
    name = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not name:
        raise ValueError("Project name must contain a letter or number.")
    return name


def build_project(project_name: str, destination: Path) -> Path:
    root = destination / safe_name(project_name)
    if root.exists() and any(root.iterdir()):
        raise FileExistsError(f"Refusing to overwrite non-empty folder: {root}")

    for folder in ("css", "js", "images", "assets"):
        (root / folder).mkdir(parents=True, exist_ok=True)

    starter_files = {
        "index.html": (
            "<!doctype html>\n"
            "<html lang=\"en\">\n"
            "<head>\n"
            "  <meta charset=\"utf-8\">\n"
            "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
            "  <title>New project</title>\n"
            "  <link rel=\"stylesheet\" href=\"css/styles.css\">\n"
            "  <script src=\"js/script.js\" defer></script>\n"
            "</head>\n"
            "<body>\n"
            "  <main><h1>Ready to build</h1></main>\n"
            "</body>\n"
            "</html>\n"
        ),
        "css/styles.css": "* { box-sizing: border-box; }\nbody { margin: 0; font-family: sans-serif; }\n",
        "js/script.js": "console.log('Project ready');\n",
    }
    for relative_path, content in starter_files.items():
        path = root / relative_path
        if not path.exists():
            path.write_text(content, encoding="utf-8")
    return root


if __name__ == "__main__":
    parser = ArgumentParser(description="Create a safe static-site starter.")
    parser.add_argument("name", help="Project name")
    parser.add_argument("--destination", type=Path, default=Path.cwd())
    args = parser.parse_args()
    print(f"Created: {build_project(args.name, args.destination).resolve()}")
