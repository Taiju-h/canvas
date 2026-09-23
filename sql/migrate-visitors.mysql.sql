-- Visitor tracking for Canvas guest use.
-- Safe to run repeatedly on the dedicated `canvas` database.

CREATE TABLE IF NOT EXISTS canvas_visitors (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  nickname VARCHAR(40) NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  ip_address VARCHAR(45) NOT NULL,
  user_agent VARCHAR(255) NOT NULL DEFAULT '',
  visit_count INT UNSIGNED NOT NULL DEFAULT 1,
  created_at BIGINT UNSIGNED NOT NULL,
  last_seen_at BIGINT UNSIGNED NOT NULL,
  INDEX idx_canvas_visitors_last_seen (last_seen_at),
  INDEX idx_canvas_visitors_nickname (nickname),
  CONSTRAINT fk_canvas_visitor_shadow_user FOREIGN KEY (id) REFERENCES canvas_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
