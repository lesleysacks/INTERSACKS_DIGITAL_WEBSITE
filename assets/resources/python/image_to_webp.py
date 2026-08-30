from argparse import ArgumentParser
from pathlib import Path
from PIL import Image

SUPPORTED = {".jpg", ".jpeg", ".png"}


def convert_images(source: Path, quality: int, overwrite: bool) -> tuple[int, int]:
    output = source / "webp"
    output.mkdir(exist_ok=True)
    converted = skipped = 0

    for path in sorted(source.iterdir()):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED:
            continue
        target = output / f"{path.stem}.webp"
        if target.exists() and not overwrite:
            skipped += 1
            continue
        with Image.open(path) as image:
            if image.mode not in {"RGB", "RGBA"}:
                image = image.convert("RGBA" if "transparency" in image.info else "RGB")
            image.save(target, "WEBP", quality=quality, method=6)
        converted += 1
    return converted, skipped


if __name__ == "__main__":
    parser = ArgumentParser(description="Convert JPG and PNG images to WebP.")
    parser.add_argument("folder", type=Path)
    parser.add_argument("--quality", type=int, choices=range(1, 101), default=82)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    done, skipped = convert_images(args.folder, args.quality, args.overwrite)
    print(f"Converted: {done} | Skipped: {skipped}")
