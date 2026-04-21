const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

const ROLES = ['STUDENT', 'FACULTY', 'HOD', 'VC'];

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('STUDENT', 'FACULTY', 'HOD', 'VC')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workflow_templates (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workflow_steps (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('FACULTY', 'HOD', 'VC')),
      label TEXT NOT NULL,
      FOREIGN KEY (template_id) REFERENCES workflow_templates(id) ON DELETE CASCADE,
      UNIQUE (template_id, step_order)
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      student_id TEXT NOT NULL,
      workflow_template_id TEXT NOT NULL,
      original_file_path TEXT NOT NULL,
      signed_file_path TEXT NOT NULL,
      status TEXT NOT NULL,
      current_step_order INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id),
      FOREIGN KEY (workflow_template_id) REFERENCES workflow_templates(id)
    );

    CREATE TABLE IF NOT EXISTS document_signatures (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      signer_id TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      signature_text TEXT NOT NULL,
      page INTEGER NOT NULL DEFAULT 0,
      x REAL NOT NULL DEFAULT 40,
      y REAL NOT NULL DEFAULT 40,
      signed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (signer_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS document_events (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      actor_id TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_id) REFERENCES users(id)
    );
  `);

  seedDefaults();
}

function seedDefaults() {
  const workflowCount = db.prepare('SELECT COUNT(*) AS count FROM workflow_templates').get().count;
  if (workflowCount === 0) {
    const templateId = crypto.randomUUID();

    db.prepare(
      'INSERT INTO workflow_templates (id, name, description, is_active) VALUES (?, ?, ?, 1)'
    ).run(
      templateId,
      'Scholarship Approval Workflow',
      'Faculty approval required before HOD and VC approvals.'
    );

    const steps = [
      { order: 1, role: 'FACULTY', label: 'Faculty Review' },
      { order: 2, role: 'HOD', label: 'HOD Approval' },
      { order: 3, role: 'VC', label: 'VC Approval' },
    ];

    const stepStmt = db.prepare(
      'INSERT INTO workflow_steps (id, template_id, step_order, role, label) VALUES (?, ?, ?, ?, ?)'
    );
    for (const step of steps) {
      stepStmt.run(crypto.randomUUID(), templateId, step.order, step.role, step.label);
    }
  }

  // No demo users — real users register via /api/auth/register
}

module.exports = {
  db,
  initDb,
  ROLES,
};
