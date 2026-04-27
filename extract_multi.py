"""
Multi-Format Budget Extraction Pipeline (pure Python, no system deps)
======================================================================
Uses PyMuPDF for text extraction instead of the pdftotext CLI, so it
runs on Render.com / any standard Python host without requiring
poppler-utils or any other system packages.
"""

import json
import re
import sys
from abc import ABC, abstractmethod
from pathlib import Path

import pymupdf

ACTIVITY_RE = re.compile(r"ACTIVITY\s+(\d+)\s+(.+)")


def parse_money(s: str):
    s = s.strip().replace("$", "").replace(",", "")
    if s in ("", "–", "—", "-"):
        return None
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    try:
        return float(s)
    except ValueError:
        return None


class BudgetParser(ABC):
    format_id: str = "unknown"
    column_schema: list[str] = []

    @classmethod
    @abstractmethod
    def detect(cls, sample_text: str) -> float: ...

    @abstractmethod
    def parse_page(self, page_text: str) -> list[dict] | None: ...


class UsviFy25Parser(BudgetParser):
    format_id = "usvi_3col_actuals_revised_recommendation"
    column_schema = ["actuals", "revised_budget", "recommendation"]

    HEADER_RE = re.compile(
        r"(?:FY\d+\s+)?ACTUALS\s+(?:FY\d+\s+)?REVISED\s+BUDGET\s+(?:FY\d+\s+)?RECOMMENDATION",
        re.IGNORECASE,
    )
    MONEY_RE = re.compile(r"-?\$[\d,]+(?:\.\d+)?|\(\$?[\d,]+\)|–|—")
    FUND_RE = re.compile(r"^\s*(\d{4})\s*-\s*([A-Z][A-Z0-9 &/\-]+?)\s*$")

    @classmethod
    def detect(cls, sample_text: str) -> float:
        header_hits = len(cls.HEADER_RE.findall(sample_text))
        dollar_lines = sum(
            1 for line in sample_text.split("\n")
            if line.count("$") >= 2 and "ACTUALS" not in line.upper()
        )
        if header_hits >= 3 and dollar_lines >= 5:
            return 0.95
        if header_hits >= 1:
            return 0.6
        return 0.0

    def parse_page(self, page_text: str) -> list[dict] | None:
        if not self.HEADER_RE.search(page_text):
            return None

        rows = []
        current_fund = None
        in_table = False

        for line in page_text.split("\n"):
            if self.HEADER_RE.search(line):
                in_table = True
                continue
            if not in_table or not line.strip():
                continue

            fund_match = self.FUND_RE.match(line)
            if fund_match and "TOTAL" not in line:
                current_fund = f"{fund_match.group(1)} - {fund_match.group(2).strip()}"
                continue

            money_tokens = list(self.MONEY_RE.finditer(line))
            if len(money_tokens) >= 3:
                last_three = money_tokens[-3:]
                label = line[: last_three[0].start()].strip()
                label = re.sub(r"\s+", " ", label)
                if (
                    label
                    and len(label) > 1
                    and not label.replace(",", "").replace("$", "").replace("-", "").isdigit()
                ):
                    rows.append({
                        "fund": current_fund,
                        "line_item": label,
                        "actuals": parse_money(last_three[0].group()),
                        "revised_budget": parse_money(last_three[1].group()),
                        "recommendation": parse_money(last_three[2].group()),
                    })
        return rows if rows else None


class UsviFy23Parser(BudgetParser):
    format_id = "usvi_4col_actuals_budget_rec_rec"
    column_schema = ["actuals", "budget", "rec_year_1", "rec_year_2"]

    HEADER_RE = re.compile(
        r"BY\s+BUDGET\s+CATEGORY.*?ACTUALS\s+.*?BUDGET\s+.*?RECOMMENDATION\s+.*?RECOMMENDATION",
        re.IGNORECASE,
    )
    MONEY_RE = re.compile(r"-?[\d,]+(?:\.\d+)?|–|—")
    FUND_LABELS = {
        "Appropriated Funds", "General Fund", "Federal Funds",
        "Non-Appropriated Funds", "Other Appropriated Funds",
        "Other Non-Appropriated Funds", "Internal Revenue Matching Fund",
    }

    @classmethod
    def detect(cls, sample_text: str) -> float:
        header_hits = len(cls.HEADER_RE.findall(sample_text))
        total_marker = sample_text.count("TOTAL APPROPRIATED FUNDS")
        if header_hits >= 3 and total_marker >= 3:
            return 0.95
        if header_hits >= 1:
            return 0.5
        return 0.0

    def parse_page(self, page_text: str) -> list[dict] | None:
        if not self.HEADER_RE.search(page_text):
            return None

        rows = []
        current_fund = None
        in_table = False

        for line in page_text.split("\n"):
            if self.HEADER_RE.search(line):
                in_table = True
                continue
            if not in_table or not line.strip():
                continue

            stripped = line.strip()
            if stripped in self.FUND_LABELS or any(stripped.startswith(f) for f in self.FUND_LABELS):
                current_fund = stripped
                continue

            money_tokens = list(self.MONEY_RE.finditer(line))
            if len(money_tokens) >= 4:
                last_four = money_tokens[-4:]
                label = line[: last_four[0].start()].strip()
                label = re.sub(r"\s+", " ", label)
                if label and len(label) > 2 and not label.replace(",", "").replace("-", "").isdigit():
                    rows.append({
                        "fund": current_fund,
                        "line_item": label,
                        "actuals": parse_money(last_four[0].group()),
                        "budget": parse_money(last_four[1].group()),
                        "rec_year_1": parse_money(last_four[2].group()),
                        "rec_year_2": parse_money(last_four[3].group()),
                    })
        return rows if rows else None


PARSERS: list[type[BudgetParser]] = [UsviFy25Parser, UsviFy23Parser]


def detect_format(text_sample: str):
    scores = [(P.format_id, P.detect(text_sample)) for P in PARSERS]
    scores.sort(key=lambda x: x[1], reverse=True)
    if not scores or scores[0][1] < 0.3:
        return UsviFy25Parser(), 0.0, scores
    winner_id = scores[0][0]
    winner_cls = next(P for P in PARSERS if P.format_id == winner_id)
    return winner_cls(), scores[0][1], scores


def detect_section(page_text: str) -> dict:
    info = {"title": None, "activity_code": None, "activity_name": None}
    lines = [l.strip() for l in page_text.split("\n") if l.strip()]
    title_lines = []
    for line in lines[:5]:
        if line.isupper() and len(line) > 3 and not re.match(r"^\d", line):
            title_lines.append(line)
        elif title_lines:
            break
    if title_lines:
        info["title"] = " ".join(title_lines)
    activity = ACTIVITY_RE.search(page_text)
    if activity:
        info["activity_code"] = activity.group(1)
        info["activity_name"] = activity.group(2).strip()
    return info


def _extract_page_text(page) -> str:
    """Extract one page's text using word-level Y-coordinate row grouping."""
    words = page.get_text("words")  # (x0, y0, x1, y1, word, block, line, word_no)
    rows = {}
    for w in words:
        y_bucket = round(w[1] / 4) * 4
        rows.setdefault(y_bucket, []).append(w)
    lines = []
    for y in sorted(rows.keys()):
        row_words = sorted(rows[y], key=lambda w: w[0])
        lines.append(" ".join(w[4] for w in row_words))
    return "\n".join(lines)


def extract_pages_text(pdf_path: str) -> list[str]:
    """Eager extraction (kept for CLI use). For low-memory web use, prefer
    process_pdf which streams pages one at a time."""
    doc = pymupdf.open(pdf_path)
    pages_out = [_extract_page_text(page) for page in doc]
    doc.close()
    return pages_out


def process_pdf(pdf_path: str, out_dir: str, log=print) -> dict:
    """Streaming page-at-a-time extraction. Peak RAM stays under ~200 MB
    even for 100 MB / 1000-page PDFs because we never hold all page texts
    in memory simultaneously."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    name = Path(pdf_path).stem

    log(f"[1/4] Opening PDF and detecting format...")
    doc = pymupdf.open(pdf_path)
    page_count = doc.page_count

    # Format detection: read a small sample of pages from the middle and end
    # of the document where tables are densest, instead of loading every page.
    sample_size = min(40, max(5, page_count // 20))
    mid = page_count // 2
    sample_indices = list(range(mid, min(mid + sample_size, page_count)))
    sample_indices += list(range(max(0, page_count - sample_size), page_count))
    sample_indices = sorted(set(sample_indices))
    sample_texts = [_extract_page_text(doc[i]) for i in sample_indices]
    sample = "\n".join(sample_texts)
    del sample_texts  # release memory before main loop
    parser, confidence, scores = detect_format(sample)
    log(f"      Format: {parser.format_id} (confidence {confidence:.2f})")

    log(f"[2/4] Streaming {page_count} pages and parsing...")
    structured = []
    financials_only = []

    # Stream Markdown chunks straight to disk so we never hold all of them in RAM
    name = Path(pdf_path).stem
    md_path = out_dir / f"{name}_chunks.md"
    md_file = open(md_path, "w")
    first_chunk = True

    for page_num in range(1, page_count + 1):
        page = doc[page_num - 1]
        page_text = _extract_page_text(page)
        if not page_text.strip():
            continue

        section = detect_section(page_text)
        rows = parser.parse_page(page_text)
        record = {
            "page": page_num,
            "title": section["title"],
            "activity_code": section["activity_code"],
            "activity_name": section["activity_name"],
            "rows": rows,
        }
        structured.append(record)
        if rows:
            financials_only.append(record)

        # Write narrative chunk straight to disk
        header = f"## Page {page_num}"
        if section["title"]:
            header += f" — {section['title']}"
        if section["activity_code"]:
            header += f" (Activity {section['activity_code']})"
        clean = re.sub(r"\n{3,}", "\n\n", page_text).strip()
        if not first_chunk:
            md_file.write("\n\n---\n\n")
        md_file.write(f"{header}\n\n{clean}")
        first_chunk = False

        # Drop references to give the GC a chance to free PyMuPDF buffers
        del page_text, page

    md_file.close()
    doc.close()

    log(f"[3/4] Writing structured outputs...")
    json_path = out_dir / f"{name}_structured.json"
    fin_path = out_dir / f"{name}_financials.json"

    output_meta = {
        "format_id": parser.format_id,
        "column_schema": parser.column_schema,
        "format_confidence": confidence,
        "format_scores": dict(scores),
        "source_pdf": Path(pdf_path).name,
        "page_count": page_count,
    }

    json_path.write_text(json.dumps({"meta": output_meta, "pages": structured}, indent=2))
    fin_path.write_text(json.dumps({"meta": output_meta, "pages": financials_only}, indent=2))

    log(f"[4/4] Done.")
    pdf_size_mb = round(Path(pdf_path).stat().st_size / 1e6, 1)

    total_line_items = sum(len(r["rows"]) for r in financials_only)
    pdf_size_mb = round(Path(pdf_path).stat().st_size / 1e6, 1)

    return {
        "name": name,
        "format_id": parser.format_id,
        "format_confidence": confidence,
        "format_scores": dict(scores),
        "pdf_size_mb": pdf_size_mb,
        "pages": page_count,
        "pages_with_tables": len(financials_only),
        "total_line_items": total_line_items,
        "files": {
            "structured": str(json_path),
            "financials": str(fin_path),
            "narrative": str(md_path),
        },
    }


if __name__ == "__main__":
    pdf = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "./output"
    result = process_pdf(pdf, out)
    print(f"\n  Format: {result['format_id']}")
    print(f"  Pages with tables: {result['pages_with_tables']} / {result['pages']}")
    print(f"  Line items: {result['total_line_items']}")
