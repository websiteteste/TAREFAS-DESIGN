require("dotenv").config();

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const upload = multer({ dest: path.join(__dirname, "uploads") });
const PORT = process.env.PORT || 3333;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret";
const DATABASE_URL = process.env.DATABASE_URL || process.env.DESIGN_TAREFAS_DATABASE_URL || "";
const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : null;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

let demands = [];
let notifications = [];
let budgets = [];

async function readStoredUsers() {
  if (!pool) {
    const error = new Error("Banco de dados nao configurado.");
    error.statusCode = 503;
    throw error;
  }

  const result = await pool.query(
    `
      SELECT payload
      FROM public.app_state
      WHERE id = $1
      LIMIT 1
    `,
    ["main"]
  );

  if (Array.isArray(result.rows[0]?.payload?.users)) {
    return result.rows[0].payload.users;
  }

  const authResult = await pool.query(
    `
      SELECT payload
      FROM public.users
      WHERE id = $1
      LIMIT 1
    `,
    ["auth"]
  );

  return Array.isArray(authResult.rows[0]?.payload?.users) ? authResult.rows[0].payload.users : [];
}

function normalizeLogin(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function findStoredUser(users, login) {
  const normalizedLogin = normalizeLogin(login);
  const normalizedPhone = normalizePhone(login);

  return users.find((user) => {
    if (!user || user.active === false) return false;
    const userName = normalizeLogin(user.user || user.username || user.login);
    const phone = normalizePhone(user.phone || user.celular || user.telefone);
    return (userName && userName === normalizedLogin) || (phone && phone === normalizedPhone);
  });
}

async function verifyPassword(password, storedHash) {
  const value = String(storedHash || "");
  if (value.startsWith("$2a$") || value.startsWith("$2b$") || value.startsWith("$2y$")) {
    return bcrypt.compare(password, value);
  }

  if (value.startsWith("sha256$")) {
    const [, salt, expectedDigest] = value.split("$");
    if (!salt || !expectedDigest) return false;
    const digest = await sha256(`${salt}:${password}`);
    return timingSafeEqual(digest, expectedDigest);
  }

  return false;
}

async function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    role: user.role || "Funcionario"
  };
}

function auth(requiredRoles = []) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.replace("Bearer ", "");

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (requiredRoles.length && !requiredRoles.includes(payload.role)) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      req.user = payload;
      next();
    } catch {
      res.status(401).json({ error: "Token invalido ou ausente" });
    }
  };
}

app.post("/api/auth/login", async (req, res) => {
  const { phone, user, username, login, password } = req.body;
  const loginValue = phone || user || username || login;

  try {
    const storedUsers = await readStoredUsers();
    const account = findStoredUser(storedUsers, loginValue);

    if (!account || !(await verifyPassword(password, account.passwordHash))) {
      return res.status(401).json({ error: "Usuario ou senha incorretos" });
    }

    const safeUser = publicUser(account);
    const token = jwt.sign(safeUser, JWT_SECRET, { expiresIn: "8h" });
    res.json({ token, user: safeUser });
  } catch (error) {
    console.error("Falha no login da API:", error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Falha ao autenticar usuario" });
  }
});

app.get("/api/demands", auth(["ADM", "Designer", "Atendimento", "Cliente"]), (req, res) => {
  if (req.user.role === "Cliente") {
    return res.json(demands.filter((demand) => demand.clientId === req.user.id));
  }
  res.json(demands);
});

app.post("/api/demands", auth(["ADM", "Atendimento"]), (req, res) => {
  const demand = {
    id: crypto.randomUUID(),
    status: "Pendente",
    createdAt: new Date().toISOString(),
    history: [{ at: new Date().toISOString(), text: "Demanda criada" }],
    ...req.body
  };
  demands.unshift(demand);
  notifications.unshift({ id: crypto.randomUUID(), type: "Nova demanda", demandId: demand.id, read: false });
  res.status(201).json(demand);
});

app.patch("/api/demands/:id/status", auth(["ADM", "Designer", "Atendimento"]), (req, res) => {
  const demand = demands.find((item) => item.id === req.params.id);
  if (!demand) return res.status(404).json({ error: "Demanda nao encontrada" });

  demand.status = req.body.status;
  demand.history.push({ at: new Date().toISOString(), text: `Status alterado para ${req.body.status}` });
  res.json(demand);
});

app.post("/api/demands/:id/approval", auth(["Cliente"]), (req, res) => {
  const demand = demands.find((item) => item.id === req.params.id);
  if (!demand) return res.status(404).json({ error: "Demanda nao encontrada" });

  demand.status = req.body.approved ? "Aprovado" : "Revisão solicitada";
  demand.history.push({ at: new Date().toISOString(), text: req.body.feedback || demand.status });
  notifications.unshift({ id: crypto.randomUUID(), type: demand.status, demandId: demand.id, read: false });
  res.json(demand);
});

app.post("/api/files", auth(["ADM", "Designer", "Atendimento"]), upload.array("files"), (req, res) => {
  const files = req.files.map((file) => ({
    id: file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    path: `/uploads/${file.filename}`
  }));
  res.status(201).json(files);
});

app.post("/api/budgets", auth(["ADM", "Atendimento"]), (req, res) => {
  const budget = { id: crypto.randomUUID(), status: "Aguardando", createdAt: new Date().toISOString(), ...req.body };
  budgets.unshift(budget);
  res.status(201).json(budget);
});

app.patch("/api/budgets/:id", auth(["ADM", "Atendimento"]), (req, res) => {
  const budget = budgets.find((item) => item.id === req.params.id);
  if (!budget) return res.status(404).json({ error: "Orcamento nao encontrado" });
  Object.assign(budget, req.body);
  res.json(budget);
});

app.get("/api/notifications", auth(["ADM", "Designer", "Atendimento", "Cliente"]), (req, res) => {
  res.json(notifications);
});

app.listen(PORT, () => {
  console.log(`DESIGN TAREFAS API rodando em http://localhost:${PORT}`);
});
