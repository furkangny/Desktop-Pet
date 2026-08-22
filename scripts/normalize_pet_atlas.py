"""Normalize a generated 8x11 pet atlas to the Codex v2 cell contract."""

from __future__ import annotations

import argparse
from array import array
from collections import deque
from pathlib import Path

from PIL import Image


CELL_WIDTH = 192
CELL_HEIGHT = 208
USED_COLUMNS = (7, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8)


def label_components(image: Image.Image) -> tuple[array, list[dict[str, float]]]:
    width, height = image.size
    alpha = image.getchannel("A").tobytes()
    labels = array("H", [0]) * (width * height)
    components: list[dict[str, float]] = []
    label = 0
    for seed, value in enumerate(alpha):
        if value <= 12 or labels[seed]:
            continue
        label += 1
        queue = deque([seed])
        labels[seed] = label
        area = sum_x = sum_y = 0
        min_x = max_x = seed % width
        min_y = max_y = seed // width
        while queue:
            index = queue.popleft()
            x, y = index % width, index // width
            area += 1
            sum_x += x
            sum_y += y
            min_x, max_x = min(min_x, x), max(max_x, x)
            min_y, max_y = min(min_y, y), max(max_y, y)
            for next_y in range(max(0, y - 1), min(height, y + 2)):
                row_start = next_y * width
                for next_x in range(max(0, x - 1), min(width, x + 2)):
                    next_index = row_start + next_x
                    if alpha[next_index] > 12 and not labels[next_index]:
                        labels[next_index] = label
                        queue.append(next_index)
        components.append({
            "label": label,
            "area": area,
            "center_x": sum_x / area,
            "center_y": sum_y / area,
            "left": min_x,
            "top": min_y,
            "right": max_x + 1,
            "bottom": max_y + 1,
        })
    return labels, components


def extract_component(image: Image.Image, labels: array, component: dict[str, float]) -> Image.Image:
    left, top = int(component["left"]), int(component["top"])
    right, bottom = int(component["right"]), int(component["bottom"])
    result = Image.new("RGBA", (right - left, bottom - top))
    source_pixels = image.load()
    result_pixels = result.load()
    selected_label = int(component["label"])
    for y in range(top, bottom):
        for x in range(left, right):
            if labels[y * image.width + x] == selected_label:
                result_pixels[x - left, y - top] = source_pixels[x, y]
    return result


def compose_generated(source_path: Path, target_path: Path) -> None:
    source = Image.open(source_path).convert("RGBA")
    atlas = Image.new("RGBA", (1536, 2288))
    labels, components = label_components(source)
    source_cell_width = source.width / 8
    source_cell_height = source.height / 11
    characters = [
        component
        for component in components
        if component["area"] > 3_000
        and component["right"] - component["left"] < source_cell_width * 1.4
        and component["bottom"] - component["top"] < source_cell_height * 1.4
    ]
    for row in range(11):
        for column in range(8):
            center_x = (column + 0.5) * source_cell_width
            center_y = (row + 0.5) * source_cell_height
            component = min(
                characters,
                key=lambda item: (
                    ((item["center_x"] - center_x) / source_cell_width) ** 2
                    + ((item["center_y"] - center_y) / source_cell_height) ** 2
                ),
            )
            character = extract_component(source, labels, component)
            scale = min(166 / character.width, 186 / character.height)
            size = (max(1, round(character.width * scale)), max(1, round(character.height * scale)))
            character = character.resize(size, Image.Resampling.LANCZOS)
            x = column * CELL_WIDTH + (CELL_WIDTH - size[0]) // 2
            y = row * CELL_HEIGHT + 196 - size[1]
            atlas.alpha_composite(character, (x, y))
    target_path.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(target_path, "WEBP", lossless=True, method=6, exact=True)
    normalize(target_path)


def normalize(path: Path) -> None:
    image = Image.open(path).convert("RGBA")
    if image.size != (1536, 2288):
        image = image.resize((1536, 2288), Image.Resampling.LANCZOS)

    for row, used_columns in enumerate(USED_COLUMNS):
        for column in range(used_columns, 8):
            image.paste(
                (0, 0, 0, 0),
                (
                    column * CELL_WIDTH,
                    row * CELL_HEIGHT,
                    (column + 1) * CELL_WIDTH,
                    (row + 1) * CELL_HEIGHT,
                ),
            )

    image.putdata(
        [
            (red, green, blue, alpha) if alpha else (0, 0, 0, 0)
            for red, green, blue, alpha in image.getdata()
        ]
    )
    image.save(path, "WEBP", lossless=True, method=6, exact=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("atlases", nargs="*")
    parser.add_argument("--compose", nargs=2, metavar=("SOURCE", "TARGET"))
    arguments = parser.parse_args()
    if arguments.compose:
        compose_generated(Path(arguments.compose[0]), Path(arguments.compose[1]))
    for atlas in arguments.atlases:
        normalize(Path(atlas))
