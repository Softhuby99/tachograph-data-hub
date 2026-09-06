#!/usr/bin/env python3
"""
ocr_run – OCR für gescannte Typgenehmigungs-Bescheide (PDF ohne Textebene).

Läuft NICHT zur Laufzeit in der Anwendung, sondern vorab.  Das Ergebnis wird
als Textdatei abgelegt und vom jrc_country_resolver.py ausgewertet, wenn
pdftotext keine Textebene findet (PDF ist ein reiner Bildscan).

Voraussetzungen: tesseract-ocr (+ Sprachpakete -deu, -fra, -eng)
                 pdftoppm (poppler-utils) zur PDF→Bild-Konvertierung

Aufruf:
    python3 tools/ocr_run.py --pdf ta_pdfs/e2-53.pdf --lang fra
    python3 tools/ocr_run.py --dir ta_pdfs/ --lang deu,fra,eng

Die Ausgabe wird neben das PDF geschrieben: <basename>.ocr.txt
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def pdf_to_images(pdf: Path, out_dir: Path, dpi: int = 300) -> list[Path]:
    """Convert each PDF page to a PNG via pdftoppm."""
    stem = out_dir / pdf.stem
    subprocess.run(
        ["pdftoppm", "-png", "-r", str(dpi), str(pdf), str(stem)],
        check=True, capture_output=True, timeout=120,
    )
    return sorted(out_dir.glob(f"{pdf.stem}-*.png"))


def ocr_image(img: Path, langs: list[str]) -> str:
    """Run tesseract on one image, return the text."""
    try:
        r = subprocess.run(
            ["tesseract", str(img), "-", "-l", "+".join(langs)],
            capture_output=True, text=True, timeout=90,
        )
        return r.stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def ocr_pdf(pdf: Path, langs: list[str]) -> str:
    """OCR every page of a scanned PDF, return concatenated text."""
    tmp_dir = pdf.parent / f".ocr_{pdf.stem}"
    tmp_dir.mkdir(exist_ok=True)
    try:
        images = pdf_to_images(pdf, tmp_dir)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""
    parts: list[str] = []
    for img in images:
        parts.append(ocr_image(img, langs))
        img.unlink(missing_ok=True)
    tmp_dir.rmdir()
    return "\n".join(p for p in parts if p.strip())


def main():
    ap = argparse.ArgumentParser(description="OCR scanned type approval PDFs with tesseract.")
    ap.add_argument("--pdf", help="Single PDF file to OCR")
    ap.add_argument("--dir", help="OCR all PDFs in this directory")
    ap.add_argument("--lang", default="eng,deu,fra", help="Tesseract languages (comma-separated, default: eng,deu,fra)")
    args = ap.parse_args()

    langs = [l.strip() for l in args.lang.split(",") if l.strip()]
    if not langs:
        print("ERROR: no languages specified", file=sys.stderr)
        sys.exit(1)

    pdfs: list[Path] = []
    if args.pdf:
        pdfs = [Path(args.pdf)]
    elif args.dir:
        pdfs = sorted(Path(args.dir).glob("*.pdf"))
    else:
        ap.error("Provide --pdf or --dir")

    count = 0
    for pdf in pdfs:
        if not pdf.exists():
            continue
        out = pdf.with_suffix(".ocr.txt")
        if out.exists():
            continue
        text = ocr_pdf(pdf, langs)
        if text.strip():
            out.write_text(text, encoding="utf-8")
            count += 1
            print(f"  OCR: {pdf.name} -> {out.name} ({len(text)} chars)")

    print(f"\nDone. {count} file(s) OCR'd.")


if __name__ == "__main__":
    main()
