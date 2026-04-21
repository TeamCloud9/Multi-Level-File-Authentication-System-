import { useEffect, useMemo, useRef, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';
const ROLES = ['STUDENT', 'FACULTY', 'HOD', 'VC'];

async function apiRequest(
  path,
  { method = 'GET', token, body, isFormData = false, onUnauthorized } = {}
) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (body && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    if (response.status === 401 && onUnauthorized) {
      onUnauthorized();
    }
    const err = new Error(data.message || `Request failed (${response.status})`);
    err.status = response.status;
    throw err;
  }

  return data;
}

function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState('register');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [registerForm, setRegisterForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'STUDENT',
  });

  async function handleLogin(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await apiRequest('/api/auth/login', { method: 'POST', body: loginForm });
      onLogin(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await apiRequest('/api/auth/register', { method: 'POST', body: registerForm });
      onLogin(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>Hierarchical Document Signing</h1>
        <p>Local-first workflow where signatures must follow a strict authority order.</p>

        <div className="mode-switch">
          <button
            className={mode === 'login' ? 'active' : ''}
            onClick={() => setMode('login')}
            type="button"
          >
            Login
          </button>
          <button
            className={mode === 'register' ? 'active' : ''}
            onClick={() => setMode('register')}
            type="button"
          >
            Register
          </button>
        </div>

        {mode === 'login' ? (
          <form className="form" onSubmit={handleLogin}>
            <label>
              Email
              <input
                type="email"
                value={loginForm.email}
                onChange={(e) => setLoginForm((s) => ({ ...s, email: e.target.value }))}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm((s) => ({ ...s, password: e.target.value }))}
                required
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? 'Logging in...' : 'Login'}
            </button>
          </form>
        ) : (
          <form className="form" onSubmit={handleRegister}>
            <label>
              Name
              <input
                type="text"
                value={registerForm.name}
                onChange={(e) => setRegisterForm((s) => ({ ...s, name: e.target.value }))}
                required
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={registerForm.email}
                onChange={(e) => setRegisterForm((s) => ({ ...s, email: e.target.value }))}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={registerForm.password}
                onChange={(e) => setRegisterForm((s) => ({ ...s, password: e.target.value }))}
                required
              />
            </label>
            <label>
              Role
              <select
                value={registerForm.role}
                onChange={(e) => setRegisterForm((s) => ({ ...s, role: e.target.value }))}
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy}>
              {busy ? 'Registering...' : 'Register'}
            </button>
          </form>
        )}

        {error ? <p className="error">{error}</p> : null}

        <div className="demo-box">
          <strong>Getting started?</strong>
          <p>Register with your real email to begin. Your role determines your access level.</p>
        </div>
      </div>
    </div>
  );
}

function DocumentDetail({ token, documentId, user, onActionComplete, onLogout }) {
  const [detail, setDetail] = useState(null);
  const [pdfUrl, setPdfUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [signatureForm, setSignatureForm] = useState({ signatureText: user.name, page: 0, x: 40, y: 40 });
  const [rejectReason, setRejectReason] = useState('');
  const pdfUrlRef = useRef('');

  async function loadDetail() {
    setError('');
    try {
      const data = await apiRequest(`/api/documents/${documentId}`, { token, onUnauthorized: onLogout });
      setDetail(data);

      const response = await fetch(`${API_BASE}/api/documents/${documentId}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        if (response.status === 401) {
          onLogout();
          return;
        }
        throw new Error('Failed to load PDF preview.');
      }
      const blob = await response.blob();
      const nextUrl = URL.createObjectURL(blob);
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
      }
      pdfUrlRef.current = nextUrl;
      setPdfUrl(nextUrl);
    } catch (err) {
      if (err.status === 401) {
        return;
      }
      setError(err.message);
    }
  }

  useEffect(() => {
    loadDetail();
    return () => {
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = '';
      }
    };
  }, [documentId]);

  const canSign = useMemo(() => {
    if (!detail?.document) return false;
    return (
      detail.document.status.startsWith('PENDING_') &&
      user.role !== 'STUDENT' &&
      detail.document.currentRole === user.role
    );
  }, [detail, user.role]);

  async function handleSign(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/api/documents/${documentId}/sign`, {
        method: 'POST',
        token,
        onUnauthorized: onLogout,
        body: {
          signatureText: signatureForm.signatureText,
          page: Number(signatureForm.page),
          x: Number(signatureForm.x),
          y: Number(signatureForm.y),
        },
      });
      await loadDetail();
      await onActionComplete();
    } catch (err) {
      if (err.status === 401) {
        return;
      }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/api/documents/${documentId}/reject`, {
        method: 'POST',
        token,
        onUnauthorized: onLogout,
        body: { reason: rejectReason },
      });
      setRejectReason('');
      await loadDetail();
      await onActionComplete();
    } catch (err) {
      if (err.status === 401) {
        return;
      }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!detail?.document) {
    return <div className="card">Loading document...</div>;
  }

  return (
    <div className="doc-detail">
      <div className="card">
        <h3>{detail.document.title}</h3>
        <p>
          <strong>Status:</strong> {detail.document.status}
        </p>
        <p>
          <strong>Current Step:</strong> {detail.document.currentLabel || 'Completed'}
        </p>
        <p>
          <strong>Student:</strong> {detail.document.studentName}
        </p>

        <h4>Workflow Steps</h4>
        <ul>
          {detail.steps.map((step) => (
            <li key={step.order}>
              {step.order}. {step.label} ({step.role})
            </li>
          ))}
        </ul>

        <h4>Signatures</h4>
        {detail.signatures.length === 0 ? (
          <p>No signatures yet.</p>
        ) : (
          <ul>
            {detail.signatures.map((item) => (
              <li key={item.id}>
                Step {item.stepOrder}: {item.signerName} ({item.signerRole}) - {item.signatureText}
              </li>
            ))}
          </ul>
        )}

        {canSign ? (
          <div className="action-grid">
            <form className="form" onSubmit={handleSign}>
              <h4>Sign Document</h4>
              <label>
                Signature Text
                <input
                  value={signatureForm.signatureText}
                  onChange={(e) => setSignatureForm((s) => ({ ...s, signatureText: e.target.value }))}
                  required
                />
              </label>
              <div className="inline-inputs">
                <label>
                  Page
                  <input
                    type="number"
                    min="0"
                    value={signatureForm.page}
                    onChange={(e) => setSignatureForm((s) => ({ ...s, page: e.target.value }))}
                  />
                </label>
                <label>
                  X
                  <input
                    type="number"
                    min="0"
                    value={signatureForm.x}
                    onChange={(e) => setSignatureForm((s) => ({ ...s, x: e.target.value }))}
                  />
                </label>
                <label>
                  Y
                  <input
                    type="number"
                    min="0"
                    value={signatureForm.y}
                    onChange={(e) => setSignatureForm((s) => ({ ...s, y: e.target.value }))}
                  />
                </label>
              </div>
              <button type="submit" disabled={busy}>
                {busy ? 'Signing...' : 'Apply Signature'}
              </button>
            </form>

            <form className="form" onSubmit={handleReject}>
              <h4>Reject Document</h4>
              <label>
                Reason
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={4}
                  placeholder="Optional reason"
                />
              </label>
              <button type="submit" disabled={busy} className="danger">
                {busy ? 'Rejecting...' : 'Reject'}
              </button>
            </form>
          </div>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
      </div>

      <div className="card">
        <h4>PDF Preview</h4>
        {pdfUrl ? <iframe title="pdf-preview" src={pdfUrl} className="pdf-frame" /> : <p>Loading preview...</p>}
      </div>
    </div>
  );
}

function StudentDashboard({ token, user, onLogout, initialDocId }) {
  const [workflows, setWorkflows] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState(initialDocId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uploadForm, setUploadForm] = useState({ title: '', workflowTemplateId: '', file: null });

  async function loadData() {
    setError('');
    try {
      const [workflowData, documentData] = await Promise.all([
        apiRequest('/api/workflows', { token, onUnauthorized: onLogout }),
        apiRequest('/api/documents/mine', { token, onUnauthorized: onLogout }),
      ]);
      setWorkflows(workflowData.workflows);
      setDocuments(documentData.documents);
      if (!uploadForm.workflowTemplateId && workflowData.workflows[0]) {
        setUploadForm((s) => ({ ...s, workflowTemplateId: workflowData.workflows[0].id }));
      }
    } catch (err) {
      if (err.status === 401) {
        return;
      }
      setError(err.message);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleUpload(event) {
    event.preventDefault();
    if (!uploadForm.file) {
      setError('Please select a PDF file.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('title', uploadForm.title);
      formData.append('workflowTemplateId', uploadForm.workflowTemplateId);
      formData.append('file', uploadForm.file);

      await apiRequest('/api/documents/upload', {
        method: 'POST',
        token,
        onUnauthorized: onLogout,
        body: formData,
        isFormData: true,
      });

      setUploadForm((s) => ({ ...s, title: '', file: null }));
      await loadData();
    } catch (err) {
      if (err.status === 401) {
        return;
      }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dashboard">
      <header className="topbar">
        <div>
          <h2>Student Dashboard</h2>
          <p>
            {user.name} ({user.role})
          </p>
        </div>
        <button onClick={onLogout}>Logout</button>
      </header>

      <div className="grid-two">
        <section className="card">
          <h3>Upload Document</h3>
          <form className="form" onSubmit={handleUpload}>
            <label>
              Document Title
              <input
                value={uploadForm.title}
                onChange={(e) => setUploadForm((s) => ({ ...s, title: e.target.value }))}
                placeholder="Scholarship Form"
              />
            </label>

            <label>
              Workflow
              <select
                value={uploadForm.workflowTemplateId}
                onChange={(e) => setUploadForm((s) => ({ ...s, workflowTemplateId: e.target.value }))}
                required
              >
                <option value="">Select workflow</option>
                {workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              PDF File
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setUploadForm((s) => ({ ...s, file: e.target.files?.[0] || null }))}
                required
              />
            </label>

            <button type="submit" disabled={busy}>
              {busy ? 'Uploading...' : 'Upload'}
            </button>
          </form>
        </section>

        <section className="card">
          <h3>My Documents</h3>
          {documents.length === 0 ? (
            <p>No uploaded documents yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Current Role</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td>{doc.title}</td>
                    <td>{doc.status}</td>
                    <td>{doc.currentRole || '-'}</td>
                    <td>
                      <button onClick={() => setSelectedDocumentId(doc.id)}>Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {selectedDocumentId ? (
        <DocumentDetail
          token={token}
          documentId={selectedDocumentId}
          user={user}
          onActionComplete={loadData}
          onLogout={onLogout}
        />
      ) : null}

      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

function SignerDashboard({ token, user, onLogout, initialDocId }) {
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState(initialDocId || '');
  const [error, setError] = useState('');

  async function loadData() {
    setError('');
    try {
      const data = await apiRequest('/api/documents/pending', { token, onUnauthorized: onLogout });
      setDocuments(data.documents);
      if (selectedDocumentId && !data.documents.find((doc) => doc.id === selectedDocumentId)) {
        setSelectedDocumentId('');
      }
    } catch (err) {
      if (err.status === 401) {
        return;
      }
      setError(err.message);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="dashboard">
      <header className="topbar">
        <div>
          <h2>Signer Dashboard</h2>
          <p>
            {user.name} ({user.role})
          </p>
        </div>
        <button onClick={onLogout}>Logout</button>
      </header>

      <section className="card">
        <h3>Pending Actions</h3>
        {documents.length === 0 ? (
          <p>No documents pending for your role.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Student</th>
                <th>Status</th>
                <th>Current Step</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td>{doc.title}</td>
                  <td>{doc.studentName}</td>
                  <td>{doc.status}</td>
                  <td>{doc.currentLabel}</td>
                  <td>
                    <button onClick={() => setSelectedDocumentId(doc.id)}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selectedDocumentId ? (
        <DocumentDetail
          token={token}
          documentId={selectedDocumentId}
          user={user}
          onActionComplete={loadData}
          onLogout={onLogout}
        />
      ) : null}

      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState(() => {
    const raw = localStorage.getItem('auth');
    return raw ? JSON.parse(raw) : null;
  });

  function onLogin(data) {
    const nextAuth = { token: data.token, user: data.user };
    setAuth(nextAuth);
    localStorage.setItem('auth', JSON.stringify(nextAuth));
  }

  function onLogout() {
    setAuth(null);
    localStorage.removeItem('auth');
  }

  if (!auth?.token || !auth?.user) {
    return <AuthScreen onLogin={onLogin} />;
  }

  // Read ?doc= from URL so email links auto-open the document
  const initialDocId = new URLSearchParams(window.location.search).get('doc') || '';

  if (auth.user.role === 'STUDENT') {
    return <StudentDashboard token={auth.token} user={auth.user} onLogout={onLogout} initialDocId={initialDocId} />;
  }

  return <SignerDashboard token={auth.token} user={auth.user} onLogout={onLogout} initialDocId={initialDocId} />;
}
