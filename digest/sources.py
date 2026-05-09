"""RSS / Atom feeds the digest pulls from.

Curated for a Head of AI Strategy: frontier-lab announcements, mainstream
coverage of funding/policy/product, and a HN signal for what practitioners
are actually discussing.
"""

LAB_FEEDS = [
    ("Anthropic", "https://www.anthropic.com/news/rss.xml"),
    ("OpenAI", "https://openai.com/news/rss.xml"),
    ("Google DeepMind", "https://deepmind.google/blog/rss.xml"),
    ("Meta AI", "https://ai.meta.com/blog/rss/"),
]

INDUSTRY_FEEDS = [
    ("TechCrunch AI", "https://techcrunch.com/category/artificial-intelligence/feed/"),
    ("The Verge AI", "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml"),
    ("Bloomberg AI", "https://www.bloomberg.com/feeds/topics/artificial-intelligence.rss"),
]

HACKER_NEWS = [
    ("Hacker News (top, AI-filtered)", "https://hnrss.org/frontpage?q=AI+OR+LLM+OR+Anthropic+OR+OpenAI+OR+Claude+OR+GPT&points=150"),
]

ALL_FEEDS = LAB_FEEDS + INDUSTRY_FEEDS + HACKER_NEWS
