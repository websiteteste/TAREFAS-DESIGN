require("dotenv").config();

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const upload = multer({ dest: path.join(__dirname, "uploads") });
const PORT = process.env.PORT || 3333;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret";

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const users = [
  {
    id: "admin",
    name: "DESIGN TAREFAS",
    phone: "5527999990000",
    role: "ADM",
    passwordHash: bcrypt.hashSync("admin123", 10)
  },
  {
    id: "cliente-aurora",
    name: "Aurora Eventos",
    phone: "5527999990000",
    role: "Cliente",
    passwordHash: bcrypt.hashSync("gbdesign2026", 10)
  }
];

let demands = [];
let notifications = [];
let budgets = [];

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
  const { phone, password } = req.body;
  const user = users.find((item) => item.phone === String(phone).replace(/\D/g, ""));

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Celular ou senha incorretos" });
  }

  const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
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
