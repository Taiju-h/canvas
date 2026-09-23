-- Apply to a dedicated MySQL 8+ database named canvas. Never mix with nobunaga.
-- mysql -u CANVAS_DB_USER -p canvas < canvas/sql/schema.mysql.sql
CREATE TABLE IF NOT EXISTS canvas_users (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canvas_documents (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  owner_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(80) NOT NULL,
  content_json LONGTEXT NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  share_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  INDEX idx_canvas_documents_owner (owner_id, updated_at),
  CONSTRAINT fk_canvas_document_owner FOREIGN KEY (owner_id) REFERENCES canvas_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canvas_images (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  document_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_type VARCHAR(32) NOT NULL,
  image_blob LONGBLOB NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  INDEX idx_canvas_images_document (document_id),
  CONSTRAINT fk_canvas_image_document FOREIGN KEY (document_id) REFERENCES canvas_documents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canvas_login_attempts (
  key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  attempts SMALLINT UNSIGNED NOT NULL,
  last_attempt_at BIGINT UNSIGNED NOT NULL,
  INDEX idx_canvas_login_attempts_time (last_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
