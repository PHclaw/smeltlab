"""
RAG Document Chunker — semantic-aware text splitting for RAG pipelines.

Supports:
- Paragraph-aware splitting
- Heading-aware splitting (Markdown)
- Configurable chunk size and overlap
- Metadata preservation (source, chunk index, heading context)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Chunk:
    """A single text chunk with metadata."""
    text: str
    index: int
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def char_count(self) -> int:
        return len(self.text)

    @property
    def token_estimate(self) -> int:
        cjk = sum(1 for c in self.text if '一' <= c <= '鿿')
        other = len(self.text) - cjk
        return max(1, (other // 4) + (cjk // 2))


# ---------------------------------------------------------------------------
# Markdown heading detection
# ---------------------------------------------------------------------------

_HEADING_RE = re.compile(r'^(#{1,6})\s+(.+)$', re.MULTILINE)


def _extract_headings(text: str) -> list[tuple[int, int, str]]:
    """Extract (position, level, title) from markdown text."""
    headings = []
    for match in _HEADING_RE.finditer(text):
        level = len(match.group(1))
        title = match.group(2).strip()
        headings.append((match.start(), level, title))
    return headings


def _get_heading_context(position: int, headings: list[tuple[int, int, str]]) -> str:
    """Get the heading hierarchy at a given position."""
    context_parts = []
    current_levels: dict[int, str] = {}

    for pos, level, title in headings:
        if pos > position:
            break
        current_levels[level] = title
        # Remove deeper levels
        for l in list(current_levels.keys()):
            if l > level:
                del current_levels[l]

    for level in sorted(current_levels.keys()):
        context_parts.append(current_levels[level])

    return " > ".join(context_parts)


# ---------------------------------------------------------------------------
# Chunking strategies
# ---------------------------------------------------------------------------

def _split_paragraphs(text: str) -> list[str]:
    """Split text into paragraphs (separated by blank lines)."""
    paragraphs = re.split(r'\n\s*\n', text)
    return [p.strip() for p in paragraphs if p.strip()]


def chunk_text(
    text: str,
    chunk_size: int = 512,
    overlap: int = 64,
    source: str = "",
    strategy: str = "paragraph",  # paragraph | heading | character
) -> list[Chunk]:
    """
    Split text into chunks with metadata.

    Args:
        text: The full document text
        chunk_size: Target chunk size in characters
        overlap: Number of overlap characters between chunks
        source: Source file identifier
        strategy: Chunking strategy (paragraph, heading, character)
    """
    if not text or not text.strip():
        return []

    headings = _extract_headings(text) if strategy in ("paragraph", "heading") else []

    if strategy == "heading":
        return _chunk_by_heading(text, headings, chunk_size, overlap, source)
    elif strategy == "paragraph":
        return _chunk_by_paragraph(text, headings, chunk_size, overlap, source)
    else:
        return _chunk_by_character(text, chunk_size, overlap, source)


def _chunk_by_paragraph(
    text: str,
    headings: list[tuple[int, int, str]],
    chunk_size: int,
    overlap: int,
    source: str,
) -> list[Chunk]:
    """Chunk by paragraphs, merging small ones and splitting large ones."""
    paragraphs = _split_paragraphs(text)
    chunks: list[Chunk] = []
    current_text = ""
    current_start = 0
    idx = 0

    for para in paragraphs:
        if len(current_text) + len(para) + 2 <= chunk_size:
            # Merge into current chunk
            if current_text:
                current_text += "\n\n" + para
            else:
                current_text = para
        else:
            # Save current chunk
            if current_text:
                heading_ctx = _get_heading_context(current_start, headings)
                chunks.append(Chunk(
                    text=current_text,
                    index=idx,
                    metadata={
                        "source": source,
                        "heading": heading_ctx,
                        "strategy": "paragraph",
                    },
                ))
                idx += 1

            # Start new chunk with overlap
            if overlap > 0 and current_text:
                overlap_text = current_text[-overlap:]
                current_text = overlap_text + "\n\n" + para
            else:
                current_text = para
            current_start = text.find(para, current_start + len(current_text) - overlap)

    # Don't forget last chunk
    if current_text:
        heading_ctx = _get_heading_context(current_start, headings)
        chunks.append(Chunk(
            text=current_text,
            index=idx,
            metadata={
                "source": source,
                "heading": heading_ctx,
                "strategy": "paragraph",
            },
        ))

    # Split oversized chunks
    return _split_oversized(chunks, chunk_size, overlap, source)


def _chunk_by_heading(
    text: str,
    headings: list[tuple[int, int, str]],
    chunk_size: int,
    overlap: int,
    source: str,
) -> list[Chunk]:
    """Chunk by heading sections."""
    if not headings:
        return _chunk_by_paragraph(text, headings, chunk_size, overlap, source)

    chunks: list[Chunk] = []
    idx = 0

    for i, (pos, level, title) in enumerate(headings):
        # Find section end (next heading or end of text)
        end_pos = headings[i + 1][0] if i + 1 < len(headings) else len(text)
        section = text[pos:end_pos].strip()

        if not section:
            continue

        heading_ctx = _get_heading_context(pos, headings)

        if len(section) <= chunk_size:
            chunks.append(Chunk(
                text=section,
                index=idx,
                metadata={"source": source, "heading": heading_ctx, "strategy": "heading"},
            ))
            idx += 1
        else:
            # Split large sections by paragraph
            sub_chunks = _chunk_by_paragraph(section, headings, chunk_size, overlap, source)
            for sc in sub_chunks:
                sc.index = idx
                sc.metadata["heading"] = heading_ctx
                idx += 1
            chunks.extend(sub_chunks)

    return chunks


def _chunk_by_character(
    text: str,
    chunk_size: int,
    overlap: int,
    source: str,
) -> list[Chunk]:
    """Simple character-level chunking with overlap."""
    chunks: list[Chunk] = []
    idx = 0
    start = 0

    while start < len(text):
        start = max(start, 0)
        end = min(start + chunk_size, len(text))

        # Try to break at sentence boundary
        if end < len(text):
            last_period = text.rfind('.', start, end)
            last_newline = text.rfind('\n', start, end)
            break_point = max(last_period, last_newline)
            if break_point > start + chunk_size // 2:
                end = break_point + 1

        chunk_text = text[start:end].strip()
        if chunk_text:
            chunks.append(Chunk(
                text=chunk_text,
                index=idx,
                metadata={"source": source, "strategy": "character"},
            ))
            idx += 1

        next_start = end - overlap if 0 < overlap < chunk_size else end
        # 保证指针严格前进，否则（尤其是尾部窗口）会死循环
        start = next_start if next_start > start else end

    return chunks


def _split_oversized(
    chunks: list[Chunk],
    chunk_size: int,
    overlap: int,
    source: str,
) -> list[Chunk]:
    """Split any chunks that exceed chunk_size."""
    result = []
    idx = 0

    for chunk in chunks:
        if len(chunk.text) <= chunk_size:
            chunk.index = idx
            result.append(chunk)
            idx += 1
        else:
            # Split into sub-chunks
            sub = _chunk_by_character(chunk.text, chunk_size, overlap, source)
            for s in sub:
                s.index = idx
                s.metadata.update(chunk.metadata)
                s.metadata["strategy"] = "paragraph+character"
                idx += 1
            result.extend(sub)

    return result


# ---------------------------------------------------------------------------
# High-level API for DataFrame integration
# ---------------------------------------------------------------------------

def chunk_dataframe(
    texts: list[str],
    sources: list[str] | None = None,
    chunk_size: int = 512,
    overlap: int = 64,
    strategy: str = "paragraph",
) -> list[dict[str, Any]]:
    """
    Chunk multiple texts and return a flat list of chunk dicts
    suitable for creating a Polars DataFrame.
    """
    import polars as pl

    all_chunks = []
    for i, text in enumerate(texts):
        source = sources[i] if sources and i < len(sources) else f"doc_{i}"
        chunks = chunk_text(text, chunk_size=chunk_size, overlap=overlap, source=source, strategy=strategy)
        for chunk in chunks:
            all_chunks.append({
                "chunk_id": f"{source}_chunk_{chunk.index}",
                "source": source,
                "chunk_index": chunk.index,
                "text": chunk.text,
                "char_count": chunk.char_count,
                "token_estimate": chunk.token_estimate,
                "heading": chunk.metadata.get("heading", ""),
                "strategy": chunk.metadata.get("strategy", ""),
            })

    return all_chunks
