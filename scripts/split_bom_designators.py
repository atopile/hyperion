#!/usr/bin/env python3
"""
Split overlong designator cells in a BOM CSV file.

The script reads an input CSV, counts the number of characters in each cell,
and when the `Designator` column exceeds the specified limit (default 2000
characters) it splits the designators into multiple rows whose cell lengths
are within the limit. The `Quantity` column (when present) is updated to match
the number of designators in each split row.
"""

from __future__ import annotations

import argparse
import csv
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Sequence, Tuple

DEFAULT_LIMIT = 2000
MAX_LOGGED_LONG_CELLS = 20


@dataclass
class ProcessStats:
    data_rows_written: int
    header: List[str]
    max_lengths: List[int]
    long_cells: List[Tuple[int, int, int]]
    split_groups: int
    split_rows_written: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Split overlong designator cells in a BOM CSV file."
    )
    parser.add_argument(
        "input_csv",
        type=Path,
        help="Path to the source CSV (e.g. panel.bom.csv).",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Path for the rewritten CSV. Defaults to <input> with '.split.csv' suffix.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help=f"Maximum allowed characters per cell (default: {DEFAULT_LIMIT}).",
    )
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Overwrite the input file instead of writing a separate output file.",
    )
    return parser.parse_args()


def chunk_designators(designators: str, limit: int) -> List[Sequence[str]]:
    """Split a comma-separated designator string into chunks obeying the limit."""
    tokens = [token.strip() for token in designators.split(",")]
    tokens = [token for token in tokens if token]

    if not tokens:
        return [[designators]] if designators else []

    chunks: List[List[str]] = []
    current: List[str] = []

    for token in tokens:
        candidate = current + [token]
        candidate_str = ", ".join(candidate)
        if len(candidate_str) <= limit or not current:
            current.append(token)
        else:
            chunks.append(current)
            current = [token]

    if current:
        chunks.append(current)

    return chunks


def ensure_parent_directory(path: Path) -> None:
    if path.parent != Path("."):
        path.parent.mkdir(parents=True, exist_ok=True)


def process_csv(input_path: Path, output_path: Path, limit: int) -> ProcessStats:
    with input_path.open("r", newline="", encoding="utf-8") as src:
        reader = csv.reader(src)
        try:
            header = next(reader)
        except StopIteration as exc:
            raise ValueError(f"{input_path} is empty.") from exc

        if "Designator" not in header:
            raise ValueError("Input CSV does not contain a 'Designator' column.")

        designator_index = header.index("Designator")
        quantity_index = header.index("Quantity") if "Quantity" in header else None

        max_lengths = [len(column) for column in header]
        long_cells: List[Tuple[int, int, int]] = []
        data_rows_written = 0
        split_groups = 0
        split_rows_written = 0

        ensure_parent_directory(output_path)
        with output_path.open("w", newline="", encoding="utf-8") as dst:
            writer = csv.writer(dst)
            writer.writerow(header)

            for row_number, row in enumerate(reader, start=2):
                if not row:
                    continue

                lengths = [len(cell) for cell in row]
                for idx, length in enumerate(lengths):
                    if length > limit:
                        long_cells.append((row_number, idx, length))

                designator_value = row[designator_index]
                chunks = chunk_designators(designator_value, limit)

                if not chunks or len(chunks) == 1:
                    writer.writerow(row)
                    data_rows_written += 1
                    for idx, value in enumerate(row):
                        value_length = len(value)
                        if value_length > max_lengths[idx]:
                            max_lengths[idx] = value_length
                    continue

                split_groups += 1
                split_rows_written += len(chunks)

                original_quantity = (
                    row[quantity_index] if quantity_index is not None else None
                )
                original_quantity_int = None
                if quantity_index is not None and original_quantity:
                    try:
                        original_quantity_int = int(original_quantity)
                    except ValueError:
                        pass

                designator_count = sum(len(chunk) for chunk in chunks)
                if (
                    original_quantity_int is not None
                    and original_quantity_int != designator_count
                ):
                    print(
                        f"Warning: quantity ({original_quantity_int}) does not match "
                        f"number of designators ({designator_count}) in row {row_number}.",
                        file=sys.stderr,
                    )

                for chunk in chunks:
                    chunk_str = ", ".join(chunk)
                    if len(chunk_str) > limit:
                        raise ValueError(
                            f"Unable to split row {row_number} into sub-2000 character chunks."
                        )
                    new_row = list(row)
                    new_row[designator_index] = chunk_str
                    if quantity_index is not None:
                        new_row[quantity_index] = str(len(chunk))
                    writer.writerow(new_row)
                    data_rows_written += 1
                    for idx, value in enumerate(new_row):
                        value_length = len(value)
                        if value_length > max_lengths[idx]:
                            max_lengths[idx] = value_length

    return ProcessStats(
        data_rows_written=data_rows_written,
        header=list(header),
        max_lengths=max_lengths,
        long_cells=long_cells,
        split_groups=split_groups,
        split_rows_written=split_rows_written,
    )


def print_summary(stats: ProcessStats, limit: int, output_path: Path) -> None:
    print(f"Wrote {stats.data_rows_written} data rows to {output_path}")
    print("Maximum cell lengths by column:")
    for idx, length in enumerate(stats.max_lengths):
        column_name = stats.header[idx] if stats.header[idx] else f"column_{idx}"
        print(f"  {column_name}: {length}")

    if stats.long_cells:
        print(
            f"\nCells exceeding the {limit}-character limit before splitting: "
            f"{len(stats.long_cells)}"
        )
        for row_idx, col_idx, length in stats.long_cells[:MAX_LOGGED_LONG_CELLS]:
            print(
                f"  Row {row_idx}, column '{stats.header[col_idx]}' -> {length} characters"
            )
        if len(stats.long_cells) > MAX_LOGGED_LONG_CELLS:
            remaining = len(stats.long_cells) - MAX_LOGGED_LONG_CELLS
            print(f"  ... and {remaining} more")
    else:
        print(f"\nNo cells exceeded the {limit}-character limit.")

    if stats.split_groups:
        print(
            f"\nSplit {stats.split_groups} rows into "
            f"{stats.split_rows_written} rows where the designator column exceeded the limit."
        )
    else:
        print("\nNo rows required splitting.")


def main() -> None:
    args = parse_args()
    input_path = args.input_csv
    if not input_path.exists():
        raise SystemExit(f"Input CSV {input_path} does not exist.")

    if args.in_place and args.output:
        raise SystemExit("Use either --in-place or --output, not both.")

    if args.in_place:
        temp_path = input_path.with_suffix(input_path.suffix + ".tmp")
        try:
            stats = process_csv(input_path, temp_path, args.limit)
        except Exception:
            if temp_path.exists():
                temp_path.unlink()
            raise
        temp_path.replace(input_path)
        print_summary(stats, args.limit, input_path)
        return

    output_path = args.output or input_path.with_suffix(
        input_path.suffix + ".split.csv"
    )
    try:
        stats = process_csv(input_path, output_path, args.limit)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    print_summary(stats, args.limit, output_path)


if __name__ == "__main__":
    main()
