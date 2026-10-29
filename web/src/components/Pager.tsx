import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { PagerPayload } from "../engine/types";

interface PagerProps {
  pager: PagerPayload;
  onClose: () => void;
}

export default function Pager({ pager, onClose }: PagerProps) {
  const lines = useMemo(
    () => pager.content.replace(/\r/g, "").split("\n"),
    [pager.content],
  );
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(14);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pageCount = Math.max(1, Math.ceil(lines.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * pageSize;
  const visible = lines.slice(start, start + pageSize);
  const matches = useMemo(
    () =>
      activeQuery
        ? lines
            .map((line, index) => (line.includes(activeQuery) ? index : -1))
            .filter((index) => index >= 0)
        : [],
    [activeQuery, lines],
  );

  useEffect(() => {
    containerRef.current?.focus();
    const measure = () => {
      if (contentRef.current)
        setPageSize(
          Math.max(4, Math.floor(contentRef.current.clientHeight / 23)),
        );
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
    else containerRef.current?.focus();
  }, [searchOpen]);

  const search = () => {
    if (!query) return;
    setActiveQuery(query);
    const found = lines.findIndex(
      (line, index) => index > start && line.includes(query),
    );
    const fallback = lines.findIndex((line) => line.includes(query));
    const target = found >= 0 ? found : fallback;
    if (target >= 0) setPage(Math.floor(target / pageSize));
    setSearchOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (searchOpen) return;
    if (event.key.toLowerCase() === "q") onClose();
    else if (event.key === "/") {
      event.preventDefault();
      setSearchOpen(true);
    } else if (
      event.key === "ArrowDown" ||
      event.key === "PageDown" ||
      event.key === " "
    ) {
      event.preventDefault();
      setPage((value) => Math.min(value + 1, pageCount - 1));
    } else if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      setPage((value) => Math.max(value - 1, 0));
    } else if (event.key === "Home") setPage(0);
    else if (event.key === "End") setPage(pageCount - 1);
  };

  const highlight = (line: string) => {
    if (!activeQuery || !line.includes(activeQuery)) return line;
    const pieces = line.split(activeQuery);
    return pieces.map((piece, index) => (
      <span key={index}>
        {piece}
        {index < pieces.length - 1 ? <mark>{activeQuery}</mark> : null}
      </span>
    ));
  };

  return (
    <div
      className="pager"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`less 分页查看 ${pager.title}`}
    >
      <div className="pager-topbar">
        <span>
          <span className="pager-prompt">LESS</span> {pager.title}
        </span>
        <button type="button" onClick={onClose} aria-label="退出分页">
          <X size={17} />
        </button>
      </div>
      <div className="pager-content" ref={contentRef}>
        {visible.map((line, index) => (
          <div className="pager-line" key={`${start + index}-${line}`}>
            <span className="pager-line-number">
              {String(start + index + 1).padStart(3, " ")}
            </span>
            <span>{highlight(line) || " "}</span>
          </div>
        ))}
      </div>
      {searchOpen ? (
        <form
          className="pager-search"
          onSubmit={(event) => {
            event.preventDefault();
            search();
          }}
        >
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入要找的文字，回车跳转"
            aria-label="分页搜索"
          />
          <button type="button" onClick={() => setSearchOpen(false)}>
            取消
          </button>
        </form>
      ) : (
        <div className="pager-status">
          <span>
            第 {currentPage + 1} / {pageCount} 页
            {activeQuery ? ` · ${matches.length} 处匹配` : ""}
          </span>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 翻页 <kbd>/</kbd> 搜索 <kbd>q</kbd> 退出
          </span>
        </div>
      )}
    </div>
  );
}
