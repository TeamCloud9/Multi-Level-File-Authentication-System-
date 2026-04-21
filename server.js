const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const { db, initDb, ROLES } = require('./db');
const { authenticate, requireRole } = require('./middleware/auth');
const { notifySigner } = require('./mailer');

dotenv.config();

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const SIGNED_DIR = path.join(DATA_DIR, 'signed');

const DOC_SELECT_JOIN = `SELECT
  d.*,
  u.name AS student_name,
  wt.name AS workflow_name,
  ws.role AS current_role,
  ws.label AS current_label
FROM documents d
JOIN users u ON u.id = d.student_id
JOIN workflow_templates wt ON wt.id = d.workflow_template_id
LEFT JOIN workflow_steps ws
  ON ws.template_id = d.workflow_template_id
 AND ws.step_order = d.current_step_order`;

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(SIGNED_DIR, { recursive: true });

initDb();

const app = express();

app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json());

const upload = multer({
  dest: UPLOADS_DIR,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF uploads are supported.'));
    }
    return cb(null, true);
  },
});

function makeToken(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email, name: user.name }, JWT_SECRET, {
    expiresIn: '12h',
  });
}

function safeUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  };
}

function listWorkflowTemplates() {
  const templates = db
    .prepare('SELECT id, name, description, is_active, created_at FROM workflow_templates WHERE is_active = 1')
    .all();
  const stepStmt = db.prepare(
    'SELECT id, step_order, role, label FROM workflow_steps WHERE template_id = ? ORDER BY step_order ASC'
  );

  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    steps: stepStmt.all(template.id).map((step) => ({
      id: step.id,
      order: step.step_order,
      role: step.role,
      label: step.label,
    })),
  }));
}

function canAccessDocument(user, doc) {
  if (user.role === 'STUDENT') {
    return user.id === doc.student_id;
  }

  const roleInWorkflow = db
    .prepare('SELECT 1 FROM workflow_steps WHERE template_id = ? AND role = ? LIMIT 1')
    .get(doc.workflow_template_id, user.role);
  return Boolean(roleInWorkflow);
}

async function stampPdfSignature(filePath, payload) {
  const pdfBytes = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const pageIndex = Number.isInteger(payload.page) ? payload.page : 0;

  if (pages.length === 0 || pageIndex < 0 || pageIndex > pages.length - 1) {
    throw new Error('Invalid page index for signature placement.');
  }

  const targetPage = pages[pageIndex];
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const x = Number.isFinite(payload.x) ? payload.x : 40;
  const y = Number.isFinite(payload.y) ? payload.y : 40;

  targetPage.drawRectangle({
    x,
    y,
    width: 260,
    height: 70,
    color: rgb(0.95, 0.97, 0.99),
    borderColor: rgb(0.2, 0.32, 0.55),
    borderWidth: 1,
  });

  targetPage.drawText(`Signed by: ${payload.signerName}`, {
    x: x + 10,
    y: y + 46,
    size: 12,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });

  targetPage.drawText(`Role: ${payload.role}`, {
    x: x + 10,
    y: y + 30,
    size: 10,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });

  targetPage.drawText(`Signature: ${payload.signatureText}`, {
    x: x + 10,
    y: y + 14,
    size: 10,
    font,
    color: rgb(0.06, 0.21, 0.42),
  });

  targetPage.drawText(new Date().toISOString(), {
    x: x + 10,
    y: y + 2,
    size: 8,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });

  const updatedPdf = await pdfDoc.save();
  fs.writeFileSync(filePath, updatedPdf);
}

function formatDocumentRow(row) {
  return {
    id: row.id,
    title: row.title,
    studentId: row.student_id,
    studentName: row.student_name,
    workflowTemplateId: row.workflow_template_id,
    workflowName: row.workflow_name,
    status: row.status,
    currentStepOrder: row.current_step_order,
    currentRole: row.current_role,
    currentLabel: row.current_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'name, email, and password are required.' });
  }

  const normalizedRole = (role || 'STUDENT').toUpperCase();
  if (!ROLES.includes(normalizedRole)) {
    return res.status(400).json({ message: 'Invalid role.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ message: 'Email already registered.' });
  }

  const user = {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: email.toLowerCase().trim(),
    role: normalizedRole,
    passwordHash: bcrypt.hashSync(password, 10),
  };

  db.prepare('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(
    user.id,
    user.name,
    user.email,
    user.passwordHash,
    user.role
  );

  const token = makeToken(user);
  return res.status(201).json({ token, user: safeUser({ ...user, created_at: new Date().toISOString() }) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  const token = makeToken(user);
  return res.json({ token, user: safeUser(user) });
});

app.get('/api/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }
  return res.json({ user: safeUser(user) });
});

app.get('/api/workflows', authenticate, (req, res) => {
  return res.json({ workflows: listWorkflowTemplates() });
});

app.post('/api/documents/upload', authenticate, requireRole('STUDENT'), upload.single('file'), (req, res) => {
  try {
    const { workflowTemplateId, title } = req.body;
    if (!req.file) {
      return res.status(400).json({ message: 'PDF file is required.' });
    }
    if (!workflowTemplateId) {
      return res.status(400).json({ message: 'workflowTemplateId is required.' });
    }

    const template = db.prepare('SELECT id, name FROM workflow_templates WHERE id = ?').get(workflowTemplateId);
    if (!template) {
      return res.status(404).json({ message: 'Workflow template not found.' });
    }

    const firstStep = db
      .prepare(
        'SELECT step_order, role, label FROM workflow_steps WHERE template_id = ? ORDER BY step_order ASC LIMIT 1'
      )
      .get(workflowTemplateId);

    if (!firstStep) {
      return res.status(400).json({ message: 'Workflow has no steps configured.' });
    }

    const id = crypto.randomUUID();
    const docTitle = title?.trim() || req.file.originalname;
    const signedFileName = `${id}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const signedPath = path.join(SIGNED_DIR, signedFileName);
    fs.copyFileSync(req.file.path, signedPath);

    db.prepare(
      `INSERT INTO documents (
        id, title, student_id, workflow_template_id, original_file_path, signed_file_path, status, current_step_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      docTitle,
      req.user.id,
      workflowTemplateId,
      req.file.path,
      signedPath,
      `PENDING_${firstStep.role}`,
      firstStep.step_order
    );

    db.prepare(
      'INSERT INTO document_events (id, document_id, actor_id, action, detail) VALUES (?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), id, req.user.id, 'UPLOAD', `Uploaded into ${template.name}`);

    // Notify the first signer via email
    const firstSigner = db.prepare('SELECT email, name FROM users WHERE role = ? LIMIT 1').get(firstStep.role);
    if (firstSigner) {
      notifySigner(firstSigner.email, firstSigner.name, docTitle, id)
        .catch(err => console.error('[Mailer] Upload notification failed:', err.message));
    }

    return res.status(201).json({
      message: 'Document uploaded successfully.',
      document: {
        id,
        title: docTitle,
        status: `PENDING_${firstStep.role}`,
        currentStepOrder: firstStep.step_order,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Upload failed.' });
  }
});

app.get('/api/documents/mine', authenticate, requireRole('STUDENT'), (req, res) => {
  const rows = db
    .prepare(
      `${DOC_SELECT_JOIN}
      WHERE d.student_id = ?
      ORDER BY d.created_at DESC`
    )
    .all(req.user.id);

  return res.json({ documents: rows.map(formatDocumentRow) });
});

app.get('/api/documents/pending', authenticate, requireRole('FACULTY', 'HOD', 'VC'), (req, res) => {
  const rows = db
    .prepare(
      `${DOC_SELECT_JOIN}
      WHERE d.status LIKE 'PENDING_%'
        AND ws.role = ?
      ORDER BY d.updated_at ASC`
    )
    .all(req.user.role);

  return res.json({ documents: rows.map(formatDocumentRow) });
});

app.get('/api/documents/:id', authenticate, (req, res) => {
  const row = db
    .prepare(
      `${DOC_SELECT_JOIN}
      WHERE d.id = ?`
    )
    .get(req.params.id);

  if (!row) {
    return res.status(404).json({ message: 'Document not found.' });
  }

  if (!canAccessDocument(req.user, row)) {
    return res.status(403).json({ message: 'No access to this document.' });
  }

  const signatures = db
    .prepare(
      `SELECT
        ds.id,
        ds.step_order,
        ds.signature_text,
        ds.page,
        ds.x,
        ds.y,
        ds.signed_at,
        u.name AS signer_name,
        u.role AS signer_role
      FROM document_signatures ds
      JOIN users u ON u.id = ds.signer_id
      WHERE ds.document_id = ?
      ORDER BY ds.step_order ASC`
    )
    .all(req.params.id)
    .map((item) => ({
      id: item.id,
      stepOrder: item.step_order,
      signatureText: item.signature_text,
      page: item.page,
      x: item.x,
      y: item.y,
      signedAt: item.signed_at,
      signerName: item.signer_name,
      signerRole: item.signer_role,
    }));

  const steps = db
    .prepare(
      'SELECT step_order, role, label FROM workflow_steps WHERE template_id = ? ORDER BY step_order ASC'
    )
    .all(row.workflow_template_id)
    .map((step) => ({ order: step.step_order, role: step.role, label: step.label }));

  return res.json({ document: formatDocumentRow(row), signatures, steps });
});

app.get('/api/documents/:id/pdf', authenticate, (req, res) => {
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!row) {
    return res.status(404).json({ message: 'Document not found.' });
  }

  if (!canAccessDocument(req.user, row)) {
    return res.status(403).json({ message: 'No access to this document.' });
  }

  if (!fs.existsSync(row.signed_file_path)) {
    return res.status(404).json({ message: 'Signed file not found.' });
  }

  return res.sendFile(path.resolve(row.signed_file_path));
});

app.post('/api/documents/:id/sign', authenticate, requireRole('FACULTY', 'HOD', 'VC'), async (req, res) => {
  const { signatureText, page = 0, x = 40, y = 40 } = req.body;
  if (!signatureText || typeof signatureText !== 'string' || signatureText.trim().length < 2) {
    return res.status(400).json({ message: 'signatureText must be at least 2 characters.' });
  }

  const document = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!document) {
    return res.status(404).json({ message: 'Document not found.' });
  }

  if (!document.status.startsWith('PENDING_') || !document.current_step_order) {
    return res.status(400).json({ message: `Document is ${document.status}; cannot sign.` });
  }

  const currentStep = db
    .prepare('SELECT step_order, role, label FROM workflow_steps WHERE template_id = ? AND step_order = ?')
    .get(document.workflow_template_id, document.current_step_order);

  if (!currentStep) {
    return res.status(500).json({ message: 'Current workflow step is misconfigured.' });
  }

  if (currentStep.role !== req.user.role) {
    return res.status(403).json({ message: `Current step requires role ${currentStep.role}.` });
  }

  const existingStepSignature = db
    .prepare('SELECT id FROM document_signatures WHERE document_id = ? AND step_order = ? LIMIT 1')
    .get(document.id, currentStep.step_order);

  if (existingStepSignature) {
    return res.status(409).json({ message: 'This step has already been signed.' });
  }

  try {
    await stampPdfSignature(document.signed_file_path, {
      signatureText: signatureText.trim(),
      signerName: req.user.name,
      role: req.user.role,
      page: Number(page),
      x: Number(x),
      y: Number(y),
    });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Failed to apply signature to PDF.' });
  }

  const nextStep = db
    .prepare('SELECT step_order, role, label FROM workflow_steps WHERE template_id = ? AND step_order = ?')
    .get(document.workflow_template_id, currentStep.step_order + 1);

  const nextStatus = nextStep ? `PENDING_${nextStep.role}` : 'COMPLETED';
  const nextOrder = nextStep ? nextStep.step_order : null;

  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO document_signatures (
        id, document_id, signer_id, step_order, signature_text, page, x, y
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      document.id,
      req.user.id,
      currentStep.step_order,
      signatureText.trim(),
      Number(page),
      Number(x),
      Number(y)
    );

    db.prepare(
      'UPDATE documents SET status = ?, current_step_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(nextStatus, nextOrder, document.id);

    db.prepare(
      'INSERT INTO document_events (id, document_id, actor_id, action, detail) VALUES (?, ?, ?, ?, ?)'
    ).run(
      crypto.randomUUID(),
      document.id,
      req.user.id,
      'SIGN',
      nextStep ? `Moved to ${nextStep.label}` : 'Workflow completed'
    );
  });

  txn();

  // Notify the next signer via email
  if (nextStep) {
    const nextSigner = db.prepare('SELECT email, name FROM users WHERE role = ? LIMIT 1').get(nextStep.role);
    if (nextSigner) {
      notifySigner(nextSigner.email, nextSigner.name, document.title || 'Untitled', document.id)
        .catch(err => console.error('[Mailer] Sign notification failed:', err.message));
    }
  }

  return res.json({
    message: nextStep ? 'Signed successfully. Forwarded to next authority.' : 'Signed successfully. Workflow complete.',
    status: nextStatus,
    nextRole: nextStep?.role || null,
  });
});

app.post('/api/documents/:id/reject', authenticate, requireRole('FACULTY', 'HOD', 'VC'), (req, res) => {
  const { reason } = req.body;
  const document = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!document) {
    return res.status(404).json({ message: 'Document not found.' });
  }

  if (!document.status.startsWith('PENDING_') || !document.current_step_order) {
    return res.status(400).json({ message: `Document is ${document.status}; cannot reject.` });
  }

  const currentStep = db
    .prepare('SELECT step_order, role FROM workflow_steps WHERE template_id = ? AND step_order = ?')
    .get(document.workflow_template_id, document.current_step_order);

  if (!currentStep || currentStep.role !== req.user.role) {
    return res.status(403).json({ message: 'You are not allowed to reject at this step.' });
  }

  db.prepare('UPDATE documents SET status = ?, current_step_order = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    'REJECTED',
    document.id
  );

  db.prepare('INSERT INTO document_events (id, document_id, actor_id, action, detail) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(),
    document.id,
    req.user.id,
    'REJECT',
    reason?.trim() || 'Rejected without reason'
  );

  return res.json({ message: 'Document rejected.', status: 'REJECTED' });
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ message: error.message });
  }

  if (error) {
    return res.status(400).json({ message: error.message || 'Request failed.' });
  }

  return next();
});

app.listen(PORT, () => {
  console.log(`Backend API running on http://localhost:${PORT}`);
});
