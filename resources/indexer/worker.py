"""
LEANN indexer worker for Codr.

Long-lived process that communicates with the Electron main process
via JSON lines over stdin (commands) and stdout (responses).

Commands:
  init         — Initialize LEANN with config (index_path, model, backend)
  chunk_files  — AST-aware chunking of source files
  build_index  — Build embedding index from pre-chunked documents
  search       — Semantic search over the index
  shutdown     — Graceful cleanup
"""

import asyncio
import hashlib
import json
import os
import sys


def emit(msg: dict):
    """Write a JSON line to stdout."""
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class IndexerWorker:
    def __init__(self):
        self.searcher = None
        self.index_path = None
        self.embedding_model = "sentence-transformers/all-MiniLM-L6-v2"
        self.embedding_mode = "sentence-transformers"
        self.backend_name = "hnsw"

    def init(self, config: dict):
        self.index_path = config.get("index_path")
        self.embedding_model = config.get("embedding_model", self.embedding_model)
        self.embedding_mode = config.get("embedding_mode", self.embedding_mode)
        self.backend_name = config.get("backend_name", self.backend_name)

        # Pre-load the searcher if an existing index is available
        if self.index_path and os.path.exists(self.index_path):
            self._load_searcher()

    def _load_searcher(self):
        """Load or reload the searcher for the current index path."""
        if self.searcher:
            try:
                self.searcher.cleanup()
            except Exception:
                pass
            self.searcher = None

        try:
            from leann import LeannSearcher

            self.searcher = LeannSearcher(self.index_path)
            print(
                f"[indexer] Loaded LEANN index from {self.index_path}",
                file=sys.stderr,
                flush=True,
            )
        except Exception as e:
            print(
                f"[indexer] Failed to load index, will rebuild: {e}",
                file=sys.stderr,
                flush=True,
            )

    def chunk_files(self, files: list[dict]) -> list[dict]:
        """
        AST-aware chunking of source files.

        Args:
            files: list of {path, content} dicts

        Returns:
            list of {id, text, metadata} chunk dicts
        """
        from leann.chunking_utils import create_text_chunks
        from llama_index.core import Document

        # Build LlamaIndex Document objects for create_text_chunks
        documents = []
        for f in files:
            path = f.get("path", "")
            content = f.get("content", "")
            if not content.strip():
                continue
            doc = Document(
                text=content,
                metadata={"file_path": path, "source": path},
            )
            documents.append(doc)

        if not documents:
            return []

        chunks = create_text_chunks(
            documents,
            chunk_size=256,
            chunk_overlap=128,
            use_ast_chunking=True,
            ast_chunk_size=512,
            ast_chunk_overlap=64,
            ast_fallback_traditional=True,
        )

        # Assign stable IDs and normalize output
        result = []
        for i, chunk in enumerate(chunks):
            text = chunk.get("text", "") if isinstance(chunk, dict) else getattr(chunk, "text", "")
            metadata = chunk.get("metadata", {}) if isinstance(chunk, dict) else getattr(chunk, "metadata", {})
            file_path = metadata.get("file_path", f"chunk_{i}")

            # Create a stable ID from file path + chunk index within that file
            chunk_id = hashlib.sha256(
                f"{file_path}:{i}".encode()
            ).hexdigest()[:16]

            result.append({
                "id": chunk_id,
                "text": text,
                "metadata": {
                    "file_path": file_path,
                    "chunk_index": i,
                },
            })

        return result

    def build_index(self, chunks: list[dict]) -> int:
        """Build the full index from pre-chunked documents."""
        from leann import LeannBuilder

        # Close existing searcher before rebuilding
        if self.searcher:
            try:
                self.searcher.cleanup()
            except Exception:
                pass
            self.searcher = None

        builder = LeannBuilder(
            backend_name=self.backend_name,
            embedding_model=self.embedding_model,
            embedding_mode=self.embedding_mode,
            compact=True,
        )

        for chunk in chunks:
            text = chunk.get("text", "")
            metadata = chunk.get("metadata", {})
            builder.add_text(text, metadata)

        if self.index_path:
            os.makedirs(self.index_path, exist_ok=True)
            builder.build_index(self.index_path)

        # Reload searcher with the new index
        if self.index_path:
            self._load_searcher()

        return len(chunks)

    def search(self, query: str, limit: int = 15) -> list[dict]:
        """Search the index for documents matching the query."""
        if not self.searcher:
            if self.index_path and os.path.exists(self.index_path):
                self._load_searcher()
            if not self.searcher:
                return []

        results = self.searcher.search(query, top_k=limit)

        output = []
        for i, r in enumerate(results):
            output.append({
                "id": getattr(r, "id", str(i)),
                "score": float(r.score),
                "text": r.text,
                "metadata": r.metadata if hasattr(r, "metadata") else {},
            })
        return output

    def cleanup(self):
        """Clean up resources."""
        if self.searcher:
            try:
                self.searcher.cleanup()
            except Exception:
                pass
            self.searcher = None


async def main():
    worker = IndexerWorker()

    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader(limit=10 * 1024 * 1024)  # 10 MB to handle large chunk_files payloads
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
                worker.init(msg.get("config", {}))
                emit({"id": msg_id, "ok": True, "status": "ready"})

            elif cmd == "chunk_files":
                files = msg.get("files", [])
                chunks = worker.chunk_files(files)
                emit({"id": msg_id, "ok": True, "chunks": chunks})

            elif cmd == "build_index":
                chunks = msg.get("chunks", [])
                count = worker.build_index(chunks)
                emit({"id": msg_id, "ok": True, "count": count})

            elif cmd == "search":
                results = worker.search(
                    msg.get("query", ""),
                    msg.get("limit", 15),
                )
                emit({"id": msg_id, "ok": True, "results": results})

            elif cmd == "shutdown":
                worker.cleanup()
                emit({"id": msg_id, "ok": True})
                break

            else:
                emit({
                    "id": msg_id,
                    "type": "error",
                    "error": f"Unknown command: {cmd}",
                })

        except Exception as e:
            print(
                f"[indexer] Error handling {cmd}: {e}",
                file=sys.stderr,
                flush=True,
            )
            emit({"id": msg_id, "type": "error", "error": str(e)})


if __name__ == "__main__":
    asyncio.run(main())
