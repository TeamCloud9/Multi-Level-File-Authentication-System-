# Hierarchical Document Signing System (Local-First)

A full-stack MVP for strict, priority-based document signing in institutions.
A student uploads a PDF; it then moves through a chain of authorities (Faculty → HOD → VC), where each level must sign before the next one can act.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19 + Vite 7 |
| Backend | Node.js + Express 5 |
| Database | SQLite (via better-sqlite3) |
| File Storage | Local filesystem |
| PDF Signing | pdf-lib |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Email | Nodemailer (Gmail SMTP) |

## Features

- Role-based authentication (`STUDENT`, `FACULTY`, `HOD`, `VC`)
- Student upload with workflow selection
- Strict step-by-step workflow enforcement
- Signers only see documents at their level
- Signature stamping onto PDF with timestamp
- Reject action to stop workflow
- Status tracking per document
- **Gmail notifications** — signers receive an email when a document needs their signature

## Run Locally

### 1) Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Backend runs at `http://localhost:4000`.

### 2) Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Frontend runs at `http://localhost:5173`.

### 3) Gmail Notifications (optional)

Email notifications work out of the box — if not configured, the app simply skips sending emails.

To enable:

1. Enable **2-Factor Authentication** on your Google account
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) and generate an App Password
3. Add to your `backend/.env`:

```
GMAIL_USER=yourname@gmail.com
GMAIL_APP_PASSWORD=your_16_char_app_password
APP_URL=http://localhost:5173
```

Now whenever a document is uploaded or signed, the next signer gets an email with a link to the app.

### Getting Started

There are no pre-seeded accounts. Register real users through the app:

1. Register a **STUDENT** account (uses your real email)
2. Register a **FACULTY** account
3. Register a **HOD** account
4. Register a **VC** account

When a student uploads a document, the system automatically emails the next signer in the workflow.

---

## Project Structure

```
MLFAT/
├── .gitignore
├── README.md
│
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── data/                   # Runtime data (auto-created)
│   │   ├── app.db              # SQLite database
│   │   ├── uploads/            # Raw uploaded PDFs
│   │   └── signed/             # PDFs with signature stamps
│   └── src/
│       ├── db.js               # Database setup, schema & seeding
│       ├── mailer.js           # Gmail email notifications
│       ├── server.js           # All API routes & business logic
│       └── middleware/
│           └── auth.js         # JWT authentication & role middleware
│
├── frontend/
│   ├── .env.example
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx            # React mount point
│       ├── App.jsx             # All UI components
│       └── styles.css          # All styling
│
└── docs/                       # Project documentation
    └── (proposals, diagrams, presentations)
```

---

## Signing Workflow

```
Student uploads PDF
       │
       ▼
 Status: PENDING_FACULTY  →  Faculty signs  →  stamp added to PDF
       │
       ▼
 Status: PENDING_HOD      →  HOD signs      →  stamp added to PDF
       │
       ▼
 Status: PENDING_VC       →  VC signs       →  stamp added to PDF
       │
       ▼
 Status: COMPLETED

 (At any step, a signer can REJECT → Status: REJECTED, workflow stops)
```

## API Summary

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/health` | GET | — | Health check |
| `/api/auth/register` | POST | — | Register new user |
| `/api/auth/login` | POST | — | Login, get JWT |
| `/api/me` | GET | Token | Current user profile |
| `/api/workflows` | GET | Token | List workflow templates |
| `/api/documents/upload` | POST | Student | Upload PDF document |
| `/api/documents/mine` | GET | Student | Student's documents |
| `/api/documents/pending` | GET | Signer | Documents pending for signer's role |
| `/api/documents/:id` | GET | Token | Full document detail |
| `/api/documents/:id/pdf` | GET | Token | Download/preview signed PDF |
| `/api/documents/:id/sign` | POST | Signer | Sign document at current step |
| `/api/documents/:id/reject` | POST | Signer | Reject document |

## Notes

- This version is intentionally cloud-free.
- You can switch to PostgreSQL and object storage (S3/MinIO) later without changing core workflow logic.
- For detailed code explanations and step-by-step build guide, see `docs/Project_Documentation.md`.
