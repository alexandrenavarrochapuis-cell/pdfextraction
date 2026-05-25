"""
Generate a mindmap diagram of app.py (the Scotty Budget Extractor API).

Lays the node tree out left-to-right and emits an SVG; if cairosvg is
installed it also rasterises a PNG. Run from the repo root:

    python3 docs/generate_mindmap.py
"""

from pathlib import Path

# (label, [children]) — the structure of app.py and its backend link.
TREE = (
    "app.py\nScotty Budget Extractor API\n(Flask)",
    [
        ("Config & State", [
            ("Flask(__name__)", []),
            ("MAX_CONTENT_LENGTH\n200 MB upload cap", []),
            ("WORK_DIR\n/tmp/scotty_extractor", []),
            ("JOBS dict\nin-memory job store", []),
            ("FORMAT_LABELS\nfriendly format names", []),
        ]),
        ("Routes", [
            ("GET /\nindex() → index.html", []),
            ("POST /api/extract\napi_extract()", []),
            ("GET /api/download/<job_id>\napi_download()", []),
            ("POST /api/cleanup/<job_id>\napi_cleanup()", []),
            ("errorhandler 413\ntoo_large()", []),
        ]),
        ("/api/extract flow", [
            ("Validate upload\nfile present · .pdf only", []),
            ("Create job\nuuid hex[:12] + job_dir", []),
            ("Sanitise & save PDF", []),
            ("Call backend\nprocess_pdf()", []),
            ("Cost math\ntoken estimates · savings factor", []),
            ("Store JOBS[job_id]\n→ return JSON stats", []),
        ]),
        ("Backend\nextract_multi.process_pdf", [
            ("detect_format()\nUSVI 3-col / 4-col parsers", []),
            ("Stream pages (PyMuPDF)\npage-at-a-time, low RAM", []),
            ("Outputs\nstructured.json · financials.json\nchunks.md", []),
            ("Returns stats\npages · line items · format", []),
        ]),
        ("JSON response", [
            ("job_id · original_filename", []),
            ("format_id / label / subtitle\nconfidence", []),
            ("pages · pages_with_tables\ntotal_line_items", []),
            ("pdf/json token estimates\ncost_savings_factor", []),
        ]),
        ("Download path", [
            ("Zip job['files']\nin memory (BytesIO)", []),
            ("send_file\n<name>_extracted.zip", []),
        ]),
    ],
)

# Branch colours (level-1 nodes and their subtrees).
COLORS = [
    "#2563eb", "#7c3aed", "#db2777", "#059669", "#d97706", "#0891b2",
]

ROOT_FILL = "#0f172a"
NODE_W = 250
LEAF_W = 250
ROW_H = 30          # height per text line
NODE_VPAD = 14      # vertical padding inside a node
NODE_GAP = 16       # vertical gap between sibling nodes
COL_GAP = 80        # horizontal gap between levels
MARGIN = 40
CHAR_W = 7.3        # approx px per char at 13px font


def lines_of(label):
    return label.split("\n")


def node_height(label):
    return len(lines_of(label)) * ROW_H + NODE_VPAD


def node_width(label, base):
    longest = max(len(l) for l in lines_of(label))
    return max(base, int(longest * CHAR_W) + 28)


class Node:
    def __init__(self, label, children, depth):
        self.label = label
        self.depth = depth
        self.children = [Node(c, gc, depth + 1) for c, gc in children]
        self.w = node_width(label, NODE_W if depth < 2 else LEAF_W)
        self.h = node_height(label)
        self.x = 0.0
        self.y = 0.0
        self.color = "#000000"

    def subtree_height(self):
        if not self.children:
            return self.h
        ch = sum(c.subtree_height() for c in self.children)
        ch += NODE_GAP * (len(self.children) - 1)
        return max(self.h, ch)


def assign_colors(node, color=None):
    if node.depth == 1:
        color = COLORS[assign_colors.counter % len(COLORS)]
        assign_colors.counter += 1
    node.color = color or ROOT_FILL
    for c in node.children:
        assign_colors(c, color)


assign_colors.counter = 0


def layout(node, x, top):
    """Place node at column x; vertically center against its subtree starting at `top`."""
    sub_h = node.subtree_height()
    node.x = x
    node.y = top + (sub_h - node.h) / 2

    child_x = x + node.w + COL_GAP
    cursor = top
    for c in node.children:
        layout(c, child_x, cursor)
        cursor += c.subtree_height() + NODE_GAP


def collect(node, acc):
    acc.append(node)
    for c in node.children:
        collect(c, acc)


def rounded_rect(x, y, w, h, fill, stroke, text_color, label):
    parts = [
        f'<rect x="{x:.1f}" y="{y:.1f}" width="{w}" height="{h:.1f}" rx="9" ry="9" '
        f'fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>'
    ]
    ls = lines_of(label)
    total = len(ls) * ROW_H
    start_y = y + (h - total) / 2 + ROW_H * 0.7
    for i, line in enumerate(ls):
        weight = "600" if i == 0 else "400"
        size = 13 if i == 0 else 11.5
        opacity = 1.0 if i == 0 else 0.82
        parts.append(
            f'<text x="{x + w/2:.1f}" y="{start_y + i*ROW_H:.1f}" '
            f'text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" '
            f'font-size="{size}" font-weight="{weight}" fill="{text_color}" '
            f'opacity="{opacity}">{escape(line)}</text>'
        )
    return "".join(parts)


def escape(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def connector(parent, child):
    x1 = parent.x + parent.w
    y1 = parent.y + parent.h / 2
    x2 = child.x
    y2 = child.y + child.h / 2
    mx = (x1 + x2) / 2
    return (
        f'<path d="M {x1:.1f} {y1:.1f} C {mx:.1f} {y1:.1f}, {mx:.1f} {y2:.1f}, '
        f'{x2:.1f} {y2:.1f}" fill="none" stroke="{child.color}" '
        f'stroke-width="2" opacity="0.55"/>'
    )


def build():
    root = Node(TREE[0], TREE[1], depth=0)
    assign_colors(root)
    total_h = root.subtree_height()
    layout(root, MARGIN, MARGIN)

    nodes = []
    collect(root, nodes)
    max_x = max(n.x + n.w for n in nodes)
    max_y = max(n.y + n.h for n in nodes)
    width = int(max_x + MARGIN)
    height = int(max_y + MARGIN)

    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">',
        f'<rect width="{width}" height="{height}" fill="#f8fafc"/>',
    ]

    # connectors first (under nodes)
    def edges(n):
        for c in n.children:
            svg.append(connector(n, c))
            edges(c)
    edges(root)

    # nodes
    for n in nodes:
        if n.depth == 0:
            svg.append(rounded_rect(n.x, n.y, n.w, n.h, ROOT_FILL, ROOT_FILL, "#ffffff", n.label))
        elif n.depth == 1:
            svg.append(rounded_rect(n.x, n.y, n.w, n.h, n.color, n.color, "#ffffff", n.label))
        else:
            svg.append(rounded_rect(n.x, n.y, n.w, n.h, "#ffffff", n.color, "#1e293b", n.label))

    svg.append("</svg>")
    return "\n".join(svg)


def main():
    out_dir = Path(__file__).resolve().parent
    svg = build()
    svg_path = out_dir / "api_mindmap.svg"
    svg_path.write_text(svg)
    print(f"wrote {svg_path}")
    try:
        import cairosvg
        png_path = out_dir / "api_mindmap.png"
        cairosvg.svg2png(bytestring=svg.encode(), write_to=str(png_path), scale=2.0)
        print(f"wrote {png_path}")
    except ImportError:
        print("cairosvg not installed — skipped PNG")


if __name__ == "__main__":
    main()
