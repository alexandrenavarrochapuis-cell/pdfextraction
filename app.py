"""
Scotty Budget Extractor — Web App (Multi-Format)
=================================================
Browser-based PDF extraction tool. Auto-detects the budget format
and extracts financial data into structured JSON.

Run locally:
    pip install flask
    python3 app.py

Then open http://localhost:5000 in a browser.

For production:
    pip install gunicorn
    gunicorn -w 4 -b 0.0.0.0:5000 --timeout 180 app:app
"""

import io
import shutil
import tempfile
import uuid
import zipfile
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file, abort

from extract_multi import process_pdf

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024

WORK_DIR = Path(tempfile.gettempdir()) / "scotty_extractor"
WORK_DIR.mkdir(exist_ok=True, parents=True)

JOBS: dict[str, dict] = {}


# Friendly labels for the format IDs the parser library returns.
# Add new entries here as new parsers are added.
FORMAT_LABELS = {
    "usvi_3col_actuals_revised_recommendation": {
        "label": "Detailed Activity Budget",
        "subtitle": "Three columns: prior actuals, current revised, proposed",
    },
    "usvi_4col_actuals_budget_rec_rec": {
        "label": "Two-Year Executive Summary",
        "subtitle": "Four columns: prior actuals, current budget, two recommended years",
    },
    "unknown": {
        "label": "Unknown Format",
        "subtitle": "Couldn't auto-detect the table layout",
    },
}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/extract", methods=["POST"])
def api_extract():
    if "file" not in request.files:
        return jsonify({"error": "No file in request"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "No file selected"}), 400
    if not f.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Please upload a PDF file"}), 400

    job_id = uuid.uuid4().hex[:12]
    job_dir = WORK_DIR / job_id
    job_dir.mkdir()

    safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in f.filename)
    pdf_path = job_dir / safe_name
    f.save(str(pdf_path))

    try:
        stats = process_pdf(str(pdf_path), str(job_dir), log=lambda *a, **k: None)
    except Exception as e:
        shutil.rmtree(job_dir, ignore_errors=True)
        return jsonify({"error": f"Could not process this PDF. {e}"}), 422

    pdf_token_estimate = stats["pages"] * 1750
    json_size = Path(stats["files"]["financials"]).stat().st_size
    json_token_estimate = json_size // 4
    cost_savings = (
        round(pdf_token_estimate / json_token_estimate, 1)
        if json_token_estimate > 0
        else 0
    )

    fmt_meta = FORMAT_LABELS.get(stats["format_id"], FORMAT_LABELS["unknown"])

    JOBS[job_id] = {**stats, "dir": str(job_dir), "original_filename": f.filename}
    return jsonify({
        "job_id": job_id,
        "original_filename": f.filename,
        "format_id": stats["format_id"],
        "format_label": fmt_meta["label"],
        "format_subtitle": fmt_meta["subtitle"],
        "format_confidence": stats["format_confidence"],
        "pdf_size_mb": stats["pdf_size_mb"],
        "pages": stats["pages"],
        "pages_with_tables": stats["pages_with_tables"],
        "total_line_items": stats["total_line_items"],
        "pdf_token_estimate": pdf_token_estimate,
        "json_token_estimate": json_token_estimate,
        "cost_savings_factor": cost_savings,
    })


@app.route("/api/download/<job_id>")
def api_download(job_id):
    if job_id not in JOBS:
        abort(404)
    job = JOBS[job_id]
    name = job["name"]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in job["files"].values():
            zf.write(path, arcname=Path(path).name)
    buf.seek(0)

    return send_file(
        buf,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"{name}_extracted.zip",
    )


@app.route("/api/cleanup/<job_id>", methods=["POST"])
def api_cleanup(job_id):
    if job_id in JOBS:
        shutil.rmtree(JOBS[job_id]["dir"], ignore_errors=True)
        del JOBS[job_id]
    return jsonify({"ok": True})


@app.errorhandler(413)
def too_large(e):
    return jsonify({"error": "File too large. 200 MB maximum."}), 413


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
