"""
Crawl4AI worker process for Codr.

Long-lived process that communicates with the Electron main process
via JSON lines over stdin (commands) and stdout (responses).

Commands:
  init        — Start the browser (AsyncWebCrawler)
  crawl_site  — Full BFS deep crawl with streaming per-page results
  shutdown    — Graceful cleanup
"""

import asyncio
import json
import sys
from urllib.parse import urlparse

from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
from crawl4ai.deep_crawling import BFSDeepCrawlStrategy
from crawl4ai.deep_crawling.filters import FilterChain, DomainFilter, URLPatternFilter
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator
from crawl4ai.content_filter_strategy import PruningContentFilter


def emit(msg: dict):
    """Write a JSON line to stdout."""
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def get_markdown_text(result) -> str:
    """Extract markdown string from a CrawlResult, handling API variations.
    Prefer fit_markdown (pruned) but fall back to raw if pruning removed everything."""
    md = result.markdown
    if md is None:
        return ""
    if isinstance(md, str):
        return md
    # MarkdownGenerationResult object — use fit if it has real content, else raw
    fit = getattr(md, "fit_markdown", None) or ""
    raw = getattr(md, "raw_markdown", None) or ""
    if len(fit.strip()) > 50:
        return fit
    if raw.strip():
        return raw
    return fit or str(md)


def get_title(result) -> str:
    """Extract title from a CrawlResult."""
    if result.metadata and isinstance(result.metadata, dict):
        title = result.metadata.get("title", "")
        if title:
            return str(title)
    return ""


class CrawlWorker:
    def __init__(self):
        self.crawler = None

    async def init(self, config: dict):
        browser_config = BrowserConfig(
            headless=True,
            text_mode=False,  # Must be False — True can prevent JS execution on SPAs
            viewport_width=1280,
            viewport_height=720,
        )
        self.crawler = AsyncWebCrawler(config=browser_config)
        await self.crawler.__aenter__()

    async def crawl_site(self, msg_id: str, url: str, max_depth: int, max_pages: int, prefix: str | None = None):
        """
        Run a BFS deep crawl with streaming results.
        Emits one JSON line per page as it's crawled, then a 'complete' line.
        """
        if not self.crawler:
            emit({"id": msg_id, "type": "error", "error": "Worker not initialized"})
            return

        parsed = urlparse(url)
        domain = parsed.hostname or ""

        # Build filter chain
        filters = [DomainFilter(allowed_domains=[domain])]
        if prefix:
            filters.append(URLPatternFilter(patterns=[f"*{prefix}*"]))
        filter_chain = FilterChain(filters)

        strategy = BFSDeepCrawlStrategy(
            max_depth=max_depth,
            include_external=False,
            max_pages=max_pages,
            filter_chain=filter_chain,
        )

        md_generator = DefaultMarkdownGenerator(
            content_filter=PruningContentFilter(
                threshold=0.3,
                threshold_type="fixed",
                min_word_threshold=0,
            )
        )

        run_config = CrawlerRunConfig(
            deep_crawl_strategy=strategy,
            markdown_generator=md_generator,
            stream=True,
            cache_mode=CacheMode.BYPASS,
            check_robots_txt=False,
            remove_overlay_elements=True,
            word_count_threshold=10,
            wait_until="networkidle",
            page_timeout=15000,
            semaphore_count=5,  # Crawl up to 5 pages concurrently
        )

        pages_crawled = 0

        try:
            async for result in await self.crawler.arun(url=url, config=run_config):
                if not result.success:
                    reason = getattr(result, "error_message", None) or "unknown"
                    print(f"[crawl4ai] SKIP {result.url}: {reason}", file=sys.stderr, flush=True)
                    continue

                pages_crawled += 1
                depth = result.metadata.get("depth", 0) if result.metadata else 0
                markdown = get_markdown_text(result)
                title = get_title(result)

                # Log markdown stats to stderr for debugging
                fit_len = len(getattr(result.markdown, "fit_markdown", "") or "") if not isinstance(result.markdown, str) else 0
                raw_len = len(getattr(result.markdown, "raw_markdown", "") or "") if not isinstance(result.markdown, str) else 0
                print(f"[crawl4ai] {result.url}: md={len(markdown)} fit={fit_len} raw={raw_len}", file=sys.stderr, flush=True)

                emit({
                    "id": msg_id,
                    "type": "page",
                    "url": result.url,
                    "title": title,
                    "markdown": markdown,
                    "depth": depth,
                })

            emit({
                "id": msg_id,
                "type": "complete",
                "pages_crawled": pages_crawled,
            })
        except Exception as e:
            emit({
                "id": msg_id,
                "type": "error",
                "error": str(e),
                "pages_crawled": pages_crawled,
            })

    async def shutdown(self):
        if self.crawler:
            await self.crawler.__aexit__(None, None, None)
            self.crawler = None


async def main():
    worker = CrawlWorker()

    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    while True:
        line_bytes = await reader.readline()
        if not line_bytes:
            break

        line = line_bytes.decode("utf-8").strip()
        if not line:
            continue

        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        msg_id = msg.get("id", "")
        cmd = msg.get("cmd", "")

        try:
            if cmd == "init":
                await worker.init(msg.get("config", {}))
                emit({"id": msg_id, "ok": True, "status": "ready"})

            elif cmd == "crawl_site":
                await worker.crawl_site(
                    msg_id=msg_id,
                    url=msg["url"],
                    max_depth=msg.get("max_depth", 3),
                    max_pages=msg.get("max_pages", 500),
                    prefix=msg.get("prefix"),
                )

            elif cmd == "shutdown":
                await worker.shutdown()
                emit({"id": msg_id, "ok": True})
                break

            else:
                emit({"id": msg_id, "type": "error", "error": f"Unknown command: {cmd}"})

        except Exception as e:
            emit({"id": msg_id, "type": "error", "error": str(e)})


if __name__ == "__main__":
    asyncio.run(main())
