-- AK-1835-1903 D1 Schema
-- Pages, links, and categories from Wikipedia subset

CREATE TABLE pages (
  id INTEGER PRIMARY KEY,
  page_id INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  revision_id INTEGER,
  intro_text TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE links (
  id INTEGER PRIMARY KEY,
  source_page_id INTEGER NOT NULL,
  target_title TEXT NOT NULL,
  FOREIGN KEY (source_page_id) REFERENCES pages(page_id),
  UNIQUE(source_page_id, target_title)
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  page_id INTEGER NOT NULL,
  category_title TEXT NOT NULL,
  FOREIGN KEY (page_id) REFERENCES pages(page_id),
  UNIQUE(page_id, category_title)
);

CREATE INDEX idx_pages_title ON pages(title);
CREATE INDEX idx_links_source ON links(source_page_id);
CREATE INDEX idx_links_target ON links(target_title);
CREATE INDEX idx_categories_page ON categories(page_id);
