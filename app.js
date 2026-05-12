const defaultClients = [];

const statuses = ["Pendente", "Em andamento", "Em aprovação", "Revisão solicitada", "Entregue"];

const defaultTasks = [];

const defaultTeam = [];

let clients = cloneData(defaultClients);
let tasks = cloneData(defaultTasks);
let team = cloneData(defaultTeam);
let authUser = null;
let setupComplete = false;
let rememberSession = false;
let rememberedLogin = {
  enabled: false,
  user: "",
  password: ""
};

const state = {
  view: "dashboard",
  search: "",
  client: "all",
  priority: "all",
  owner: "all",
  status: "all",
  editingTaskId: null,
  editingClientId: null,
  editingTeamIndex: null
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const date = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
document.addEventListener("DOMContentLoaded", initializeApp);

async function initializeApp() {
  try {
    wireWindowFrame();
    wireLogin();
    await loadSavedData();
    updateAuthScreen();
    wireNavigation();
    wireForms();
    populateClientSelects();
    populateTeamOwners();
    renderAll();
  } catch (error) {
    console.error("Falha ao iniciar o DESIGN TAREFAS:", error);
    resetToFirstRun();
    updateAuthScreen();
    toast("Inicializacao recuperada", "Abrimos o primeiro acesso porque os dados locais nao puderam ser carregados.");
  } finally {
    hideLoadingScreen();
  }
}

async function loadSavedData() {
  const saved = await readStorage();
  if (!saved?.setupComplete || !saved?.authUser) return resetToFirstRun();

  setupComplete = true;
  authUser = saved.authUser;
  rememberSession = Boolean(saved.rememberSession);
  rememberedLogin = normalizeRememberedLogin(saved.rememberedLogin);
  clients = Array.isArray(saved.clients) ? saved.clients : [];
  tasks = Array.isArray(saved.tasks) ? saved.tasks : [];
  team = Array.isArray(saved.team) ? saved.team : [];
  normalizeTaskStatuses();
}

function resetToFirstRun() {
  setupComplete = false;
  authUser = null;
  rememberSession = false;
  rememberedLogin = {
    enabled: false,
    user: "",
    password: ""
  };
  clients = [];
  tasks = [];
  team = [];
}

function normalizeRememberedLogin(value) {
  if (!value || typeof value !== "object") {
    return {
      enabled: false,
      user: "",
      password: ""
    };
  }

  return {
    enabled: Boolean(value.enabled),
    user: String(value.user || ""),
    password: String(value.password || "")
  };
}

async function readStorage() {
  if (window.gbDatabase) {
    try {
      return await window.gbDatabase.load();
    } catch (error) {
      console.error("Falha ao ler o banco local:", error);
      return null;
    }
  }

  try {
    const raw = localStorage.getItem("designTarefasDatabase") || localStorage.getItem("gbDesignDatabase");
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error("Falha ao ler o armazenamento do navegador:", error);
    return null;
  }
}

function saveData() {
  const data = { setupComplete, authUser, rememberSession, rememberedLogin, clients, tasks, team };
  if (window.gbDatabase) {
    window.gbDatabase.save(data).catch(() => {
      toast("Banco local", "Nao foi possivel salvar os dados agora.");
    });
    return;
  }

  try {
    localStorage.setItem("designTarefasDatabase", JSON.stringify(data));
    localStorage.removeItem("gbDesignDatabase");
  } catch {
    toast("Armazenamento", "Nao foi possivel salvar no navegador.");
  }
}

function hideLoadingScreen() {
  const loadingScreen = document.getElementById("loadingScreen");
  if (!loadingScreen) return;

  window.setTimeout(() => {
    loadingScreen.classList.add("is-hidden");
    loadingScreen.addEventListener("transitionend", () => loadingScreen.remove(), { once: true });
    window.setTimeout(() => loadingScreen.remove(), 700);
  }, 700);
}

function wireWindowFrame() {
  document.getElementById("windowMinimize")?.addEventListener("click", () => {
    window.designTarefasWindow?.minimize();
  });

  document.getElementById("windowMaximize")?.addEventListener("click", async (event) => {
    const maximized = await window.designTarefasWindow?.maximize();
    event.currentTarget.textContent = maximized ? "❐" : "□";
  });

  document.getElementById("windowClose")?.addEventListener("click", () => {
    window.designTarefasWindow?.close();
  });
}

function wireLogin() {
  const form = document.getElementById("loginForm");
  const error = document.getElementById("loginError");
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    error.textContent = "";

    if (!setupComplete) {
      const name = String(data.get("setupName") || "").trim();
      const user = String(data.get("setupUser") || "").trim();
      const password = String(data.get("setupPassword") || "");
      const confirm = String(data.get("setupConfirm") || "");

      if (!name || !user || !password) {
        error.textContent = "Preencha nome, usuario e senha para continuar.";
        return;
      }

      if (password.length < 4) {
        error.textContent = "Use uma senha com pelo menos 4 caracteres.";
        return;
      }

      if (password !== confirm) {
        error.textContent = "As senhas nao conferem.";
        return;
      }

      authUser = { name, user, password };
      setupComplete = true;
      rememberedLogin = {
        enabled: false,
        user: "",
        password: ""
      };
      clients = [];
      tasks = [];
      team = [];
      saveData();
      form.reset();
      document.body.classList.remove("auth-locked", "auth-setup", "auth-login");
      renderAll();
      toast("Cadastro criado", "Painel liberado. Comece cadastrando seus clientes e tarefas.");
      return;
    }

    const user = String(data.get("user") || "").trim().toLowerCase();
    const password = String(data.get("password") || "");
    const authorized = authUser && authUser.user.toLowerCase() === user && authUser.password === password;

    if (!authorized) {
      error.textContent = "Usuario ou senha incorretos.";
      notifyWindows("Login recusado", "Confira usuario e senha para acessar o DESIGN TAREFAS.");
      return;
    }

    error.textContent = "";
    rememberSession = data.get("rememberLogin") === "on";
    rememberedLogin = rememberSession
      ? { enabled: true, user, password }
      : { enabled: false, user: "", password: "" };
    saveData();
    form.reset();
    document.body.classList.remove("auth-locked");
    toast("Acesso liberado", "Bem-vindo ao DESIGN TAREFAS.");
    notifyUpcomingTasks();
  });
}

function updateAuthScreen() {
  const setupMode = !setupComplete || !authUser;
  document.body.classList.toggle("auth-locked", setupMode || !rememberSession);
  document.body.classList.toggle("auth-setup", setupMode);
  document.body.classList.toggle("auth-login", !setupMode);

  document.getElementById("authEyebrow").textContent = setupMode ? "Primeiro acesso" : "Acesso seguro";
  document.getElementById("authTitle").textContent = setupMode ? "Configure seu painel" : "DESIGN TAREFAS";
  document.getElementById("authText").textContent = setupMode
    ? "Crie o acesso inicial para começar com tudo zerado e pronto para sua rotina."
    : "Entre para acessar tarefas, clientes, prazos e aprovações.";
  document.getElementById("authSubmitBtn").textContent = setupMode ? "Criar cadastro e abrir painel" : "Entrar";
  const rememberInput = document.querySelector('input[name="rememberLogin"]');
  if (rememberInput) rememberInput.checked = rememberSession;
  fillRememberedLoginFields();

  document.querySelectorAll("#setupFields input").forEach((input) => {
    input.required = setupMode;
  });
  document.querySelectorAll('#loginFields input:not([type="checkbox"])').forEach((input) => {
    input.required = !setupMode;
  });
}

function fillRememberedLoginFields() {
  const userInput = document.querySelector('input[name="user"]');
  const passwordInput = document.querySelector('input[name="password"]');
  const rememberInput = document.querySelector('input[name="rememberLogin"]');
  const shouldFill = setupComplete && rememberedLogin.enabled;

  if (rememberInput) rememberInput.checked = shouldFill;
  if (!shouldFill) return;
  if (userInput) userInput.value = rememberedLogin.user;
  if (passwordInput) passwordInput.value = rememberedLogin.password;
}

function wireNavigation() {
  document.querySelectorAll("[data-view], [data-view-jump]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view || button.dataset.viewJump));
  });

  document.querySelectorAll("[data-open-modal]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.openModal === "taskModal") {
        openTaskEditor();
        return;
      }
      if (button.dataset.openModal === "clientModal") {
        openClientEditor();
        return;
      }
      if (button.dataset.openModal === "teamModal") {
        openTeamEditor();
        return;
      }
      document.getElementById(button.dataset.openModal).showModal();
    });
  });

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.closeModal));
  });

  document.querySelectorAll("dialog.modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal.id);
    });
  });

  document.getElementById("newTaskBtn").addEventListener("click", () => openTaskEditor());
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
  document.getElementById("menuBtn").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));

  document.getElementById("globalSearch").addEventListener("input", (event) => {
    state.search = event.target.value.toLowerCase().trim();
    renderAll();
  });

  document.getElementById("clientFilter").addEventListener("change", (event) => {
    state.client = event.target.value;
    renderKanban();
  });

  document.getElementById("priorityFilter").addEventListener("change", (event) => {
    state.priority = event.target.value;
    renderKanban();
  });

  document.getElementById("ownerFilter").addEventListener("change", (event) => {
    state.owner = event.target.value;
    renderKanban();
  });

  document.getElementById("statusFilter").addEventListener("change", (event) => {
    state.status = event.target.value;
    renderKanban();
  });

}

function wireForms() {
  document.getElementById("taskForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      title: form.get("title"),
      client: form.get("client"),
      description: form.get("description") || "Sem descrição adicionada.",
      priority: form.get("priority"),
      due: form.get("due"),
      owner: form.get("owner") || "Equipe GB",
      budget: Number(form.get("budget")) || 0,
      checklist: defaultChecklist()
    };

    if (state.editingTaskId) {
      const task = tasks.find((item) => item.id === state.editingTaskId);
      Object.assign(task, payload);
      task.done = Math.min(task.done, task.checklist.length);
      task.comments.push("Demanda editada pelo ADM.");
      toast("Demanda atualizada", `${task.title} foi salva com as novas informações.`);
    } else {
      tasks.unshift({
        id: createId(),
        created: new Date().toISOString().slice(0, 10),
        status: "Pendente",
        comments: ["Demanda criada pelo ADM"],
        done: 0,
        attachments: 0,
        ...payload
      });
      toast("Demanda criada", "A nova tarefa entrou na coluna Pendente.");
    }

    state.editingTaskId = null;
    event.currentTarget.reset();
    closeModal("taskModal");
    populateClientSelects();
    setView("kanban");
    saveData();
    renderAll();
  });

  document.getElementById("clientForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      name: form.get("name")
    };

    if (state.editingClientId) {
      const client = clients.find((item) => item.id === state.editingClientId);
      if (!client) return;
      const previousName = client.name;
      Object.assign(client, payload);
      tasks.forEach((task) => {
        if (task.client === previousName) task.client = client.name;
      });
      if (state.client === previousName) state.client = client.name;
      toast("Cliente atualizado", `${client.name} foi salvo com as novas informações.`);
    } else {
      clients.push({
        id: createId(),
        active: 0,
        segment: "Cliente de design",
        ...payload
      });
      toast("Cliente criado", "Contato do cliente foi cadastrado.");
    }

    state.editingClientId = null;
    event.currentTarget.reset();
    closeModal("clientModal");
    populateClientSelects();
    saveData();
    renderAll();
  });

  document.getElementById("teamForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      name: form.get("name"),
      role: form.get("role")
    };

    if (state.editingTeamIndex !== null) {
      const member = team[state.editingTeamIndex];
      if (!member) return;
      const previousName = member.name;
      Object.assign(member, payload);
      tasks.forEach((task) => {
        if (task.owner === previousName) task.owner = member.name;
      });
      if (state.owner === previousName) state.owner = member.name;
      toast("Designer atualizado", `${member.name} foi salvo com as novas informações.`);
    } else {
      team.push(payload);
      toast("Designer adicionado", `${form.get("name")} entrou para a equipe de design.`);
    }

    state.editingTeamIndex = null;
    event.currentTarget.reset();
    closeModal("teamModal");
    populateTeamOwners();
    populateClientSelects();
    saveData();
    renderAll();
  });
}

function populateClientSelects() {
  const clientOptions = clients.map((client) => `<option>${client.name}</option>`).join("");
  const ownerOptions = [...new Set(tasks.map((task) => task.owner))]
    .sort()
    .map((owner) => `<option>${owner}</option>`)
    .join("");
  const statusOptions = statuses.map((status) => `<option>${status}</option>`).join("");

  document.getElementById("taskClientSelect").innerHTML = clientOptions || `<option value="">Cadastre um cliente primeiro</option>`;
  document.getElementById("clientFilter").innerHTML = `<option value="all">Todos clientes</option>${clientOptions}`;
  document.getElementById("ownerFilter").innerHTML = `<option value="all">Todos responsáveis</option>${ownerOptions}`;
  document.getElementById("statusFilter").innerHTML = `<option value="all">Todos status</option>${statusOptions}`;
  state.client = clients.some((client) => client.name === state.client) ? state.client : "all";
  state.owner = tasks.some((task) => task.owner === state.owner) ? state.owner : "all";
  state.status = statuses.includes(state.status) ? state.status : "all";
  document.getElementById("clientFilter").value = state.client;
  document.getElementById("ownerFilter").value = state.owner;
  document.getElementById("statusFilter").value = state.status;
}

function populateTeamOwners() {
  document.getElementById("teamOwnerList").innerHTML = team
    .map((member) => `<option value="${member.name}">${member.role}</option>`)
    .join("");
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === view));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  document.querySelector(".topbar").classList.toggle("visible", view === "kanban");
  document.getElementById("sidebar").classList.remove("open");
}

function logout() {
  rememberSession = false;
  saveData();
  fillRememberedLoginFields();
  document.getElementById("loginError").textContent = "";
  document.body.classList.add("auth-locked", "auth-login");
  document.body.classList.remove("auth-setup");
  document.getElementById("sidebar").classList.remove("open");
  window.designTarefasWindow?.quitApp?.();
}

function closeModal(id) {
  if (id === "taskModal") {
    state.editingTaskId = null;
    document.getElementById("taskForm").reset();
  }
  if (id === "clientModal") {
    state.editingClientId = null;
    document.getElementById("clientForm").reset();
    document.getElementById("clientModalEyebrow").textContent = "Novo cliente";
    document.getElementById("clientModalTitle").textContent = "Cadastro do contato";
    document.getElementById("clientSubmitBtn").textContent = "Criar cliente";
  }
  if (id === "teamModal") {
    state.editingTeamIndex = null;
    document.getElementById("teamForm").reset();
    document.getElementById("teamModalEyebrow").textContent = "Novo designer";
    document.querySelector("#teamModal .panel-head h2").textContent = "Adicionar à equipe";
    document.getElementById("teamSubmitBtn").textContent = "Adicionar designer";
  }
  const modal = document.getElementById(id);
  if (modal.open) modal.close();
}

function renderAll() {
  normalizeTaskStatuses();
  renderMetrics();
  renderCharts();
  renderAlerts();
  renderCalendar();
  renderKanban();
  renderClients();
  renderTeam();
}

function filteredTasks() {
  return tasks.filter((task) => {
    const haystack = `${task.title} ${task.client} ${task.description} ${task.owner}`.toLowerCase();
    const matchesSearch = !state.search || haystack.includes(state.search);
    const matchesClient = state.client === "all" || task.client === state.client;
    const matchesPriority = state.priority === "all" || task.priority === state.priority;
    const matchesOwner = state.owner === "all" || task.owner === state.owner;
    const matchesStatus = state.status === "all" || task.status === state.status;
    return matchesSearch && matchesClient && matchesPriority && matchesOwner && matchesStatus;
  });
}

function renderMetrics() {
  const delivered = tasks.filter((task) => task.status === "Entregue").length;
  const ongoing = tasks.filter((task) => ["Pendente", "Em andamento", "Em aprovação"].includes(task.status)).length;
  const approved = tasks.filter((task) => task.status === "Entregue").length;
  const reviews = tasks.filter((task) => task.status === "Revisão solicitada").length;
  const delayed = tasks.filter((task) => isOverdue(task)).length;
  const revenue = tasks.reduce((sum, task) => sum + task.budget, 0);
  const today = tasks.filter((task) => isToday(task.due)).length;
  const metrics = [
    ["Artes entregues", delivered, "▣"],
    ["Em andamento", ongoing, "◒"],
    ["Entregues", approved, "✓"],
    ["Revisões pendentes", reviews, "↻"],
    ["Demandas atrasadas", delayed, "!"],
    ["Clientes ativos", clients.length, "◎"],
    ["Faturamento mensal", money.format(revenue), "R$"],
    ["Tarefas do dia", today, "◇"]
  ];

  document.getElementById("metrics").innerHTML = metrics
    .map(([label, value, icon]) => `
      <article class="metric-card">
        <div><strong>${value}</strong><span>${label}</span></div>
        <div class="metric-icon">${icon}</div>
      </article>
    `)
    .join("");
}

function renderCharts() {
  const labels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const values = labels.map((_, index) => tasks.filter((task) => dueDate(task.created).getDay() === ((index + 1) % 7)).length);
  const max = Math.max(...values, 1);
  document.getElementById("weeklyChart").innerHTML = tasks.length
    ? values
    .map((value, index) => `
      <div class="bar">
        <span style="height:${Math.max(18, (value / max) * 190)}px"></span>
        <span>${labels[index]}</span>
      </div>
    `)
    .join("")
    : `<div class="empty-state chart-empty">Nenhuma arte entregue ainda.</div>`;
}

function renderAlerts() {
  const urgent = [...tasks]
    .filter((task) => task.status !== "Entregue")
    .sort((a, b) => dueDate(a.due) - dueDate(b.due))
    .slice(0, 4);

  document.getElementById("alerts").innerHTML = urgent.length
    ? urgent
    .map((task) => `
      <div class="alert-item">
        <strong>${task.client}</strong>
        <p>${task.title} vence em ${formatDueDate(task.due)}. Status atual: ${task.status}.</p>
      </div>
    `)
    .join("")
    : `<div class="empty-state">Sem alertas por enquanto.</div>`;
}

function renderCalendar() {
  const calendarTasks = [...tasks]
    .sort((a, b) => dueDate(a.due) - dueDate(b.due))
    .slice(0, 5);

  document.getElementById("calendar").innerHTML = calendarTasks.length
    ? calendarTasks
    .map((task) => {
      const due = dueDate(task.due);
      return `
        <div class="calendar-item">
          <div class="date-chip">${String(due.getDate()).padStart(2, "0")}</div>
          <div>
            <strong>${task.title}</strong>
            <span>${task.client} · ${formatDueDate(task.due)}</span>
          </div>
        </div>
      `;
    })
    .join("")
    : `<div class="empty-state">Nenhum prazo cadastrado.</div>`;
}

function renderKanban() {
  const visible = filteredTasks();
  renderTaskCommandPanel(visible);
  document.getElementById("kanbanBoard").innerHTML = statuses
    .map((status) => {
      const columnTasks = visible.filter((task) => task.status === status);
      return `
        <section class="kanban-column" data-status="${status}">
          <div class="column-head">
            <div>
              <strong>${status}</strong>
              <span>${columnSubtitle(status)}</span>
            </div>
            <span class="count-pill">${columnTasks.length}</span>
          </div>
          ${columnTasks.map(taskCard).join("")}
        </section>
      `;
    })
    .join("");

  document.querySelectorAll(".task-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("button, input, label, a, select, textarea")) return;
      openTaskDetail(card.dataset.id);
    });
    card.addEventListener("dragstart", () => card.classList.add("dragging"));
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
  });

  document.querySelectorAll(".kanban-column").forEach((column) => {
    column.addEventListener("dragover", (event) => event.preventDefault());
    column.addEventListener("drop", () => {
      const dragging = document.querySelector(".dragging");
      if (!dragging) return;
      const task = tasks.find((item) => item.id === dragging.dataset.id);
      task.status = column.dataset.status;
      task.comments.push(`Movida para ${column.dataset.status}`);
      task.done = Math.min(task.checklist.length, Math.max(task.done, statusProgress(column.dataset.status, task.checklist.length)));
      saveData();
      renderAll();
      toast("Status atualizado", `${task.title} agora está em ${task.status}.`);
    });
  });
}

function renderTaskCommandPanel(visible) {
  const safeTasks = visible.length ? visible : filteredTasks();
  const healthy = tasks.filter((task) => !isOverdue(task) || task.status === "Entregue").length;
  const health = Math.round((healthy / Math.max(tasks.length, 1)) * 100);
  const today = tasks.filter((task) => isToday(task.due) && task.status !== "Entregue").length;
  const critical = [...safeTasks]
    .filter((task) => task.status !== "Entregue")
    .sort((a, b) => urgencyScore(b) - urgencyScore(a))
    .slice(0, 3);

  document.getElementById("taskHealth").textContent = `${health}%`;
  document.getElementById("taskToday").textContent = today;
  document.getElementById("criticalTasks").innerHTML = critical.length
    ? critical.map((task) => `
      <button class="critical-task" onclick="openTaskDetail('${task.id}')">
        <span>${task.client}</span>
        <strong>${task.title}</strong>
        <small>${dueLabel(task)}</small>
      </button>
    `).join("")
    : `<p class="small">Nenhuma demanda crítica nos filtros atuais.</p>`;
}

function taskCard(task) {
  const percent = progressPercent(task);
  const overdue = isOverdue(task);
  const description = task.description || "Sem descrição adicionada.";
  const createdDate = formatDueDate(task.created || task.due);
  const deliveryDate = formatDueDate(task.due);
  return `
    <article class="task-card ${overdue ? "overdue" : ""}" draggable="true" data-id="${task.id}">
      <div class="task-card-top">
        <div class="task-meta">
          <span class="tag ${priorityClass(task.priority)}"><i aria-hidden="true">!</i>${task.priority}</span>
          <span class="tag due ${overdue ? "danger" : ""}"><i aria-hidden="true">◷</i>${dueLabel(task)}</span>
        </div>
      </div>
      <h3>${task.title}</h3>
      <p>${description}</p>
      <div class="task-dates">
        <span><i aria-hidden="true">+</i><small>Criada</small><strong>${createdDate}</strong></span>
        <span class="${overdue ? "is-late" : ""}"><i aria-hidden="true">◷</i><small>Entrega</small><strong>${deliveryDate}</strong></span>
      </div>
      <div class="task-progress">
        <div><span style="width:${percent}%"></span></div>
        <strong>${percent}%</strong>
      </div>
      <div class="task-stats">
        <span><i aria-hidden="true">✓</i>${task.done}/${task.checklist.length} checklist</span>
        <span><i aria-hidden="true">▣</i>${task.attachments} anexos</span>
        <span><i aria-hidden="true">☰</i>${task.comments.length} comentários</span>
      </div>
      <div class="task-people">
        <span class="status-pill"><i aria-hidden="true">◎</i>${task.client}</span>
        <span class="status-pill"><i aria-hidden="true">◇</i>${task.owner}</span>
      </div>
      <div class="task-actions">
        <button onclick="openTaskDetail('${task.id}')"><span aria-hidden="true">⊙</span>Detalhes</button>
        <button onclick="openTaskEditor('${task.id}')"><span aria-hidden="true">✎</span>Editar</button>
        <button onclick="advanceTask('${task.id}')"><span aria-hidden="true">→</span>Avançar</button>
        <button onclick="markFinal('${task.id}')"><span aria-hidden="true">✓</span>Entregar</button>
        <button class="danger-action" onclick="deleteTask('${task.id}')"><span aria-hidden="true">×</span>Excluir</button>
      </div>
    </article>
  `;
}

function renderClients() {
  const visibleClients = clients
    .filter((client) => `${client.name} ${client.segment}`.toLowerCase().includes(state.search))
  document.getElementById("clientGrid").innerHTML = visibleClients.length
    ? visibleClients
    .map((client) => `
      <article class="client-card">
        <div class="client-meta">
          <span class="status-pill">${client.segment}</span>
          <span class="status-pill">${client.active} demandas</span>
        </div>
        <h3>${client.name}</h3>
        <p>Cliente vinculado às demandas, prazos e histórico interno da agência.</p>
        <div class="avatar-row">
          <div class="avatar">${initials(client.name)}</div>
          <span class="status-pill">Contato salvo</span>
        </div>
        <div class="client-actions">
          <button onclick="openClientEditor('${client.id}')">Editar</button>
          <button class="danger-action" onclick="deleteClient('${client.id}')">Excluir</button>
        </div>
      </article>
    `)
    .join("")
    : `<div class="empty-state grid-empty">Nenhum cliente cadastrado ainda.</div>`;
}

function renderTeam() {
  document.getElementById("teamGrid").innerHTML = team.length
    ? team
    .map((member, index) => `
      <article class="team-card">
        <div class="team-card-head">
          <div class="avatar">${initials(member.name)}</div>
          <div class="team-actions">
            <button class="compact" onclick="openTeamEditor(${index})">Editar</button>
            <button class="danger-action compact" onclick="deleteTeamMember(${index})">Excluir</button>
          </div>
        </div>
        <h3>${member.name}</h3>
        <div class="role">${member.role}</div>
      </article>
    `)
    .join("")
    : `<div class="empty-state grid-empty">Nenhum profissional cadastrado ainda.</div>`;
}

function openTaskEditor(id = null) {
  const form = document.getElementById("taskForm");
  const modal = document.getElementById("taskModal");
  const detailModal = document.getElementById("taskDetailModal");
  if (detailModal.open) detailModal.close();
  form.reset();
  state.editingTaskId = id;

  document.getElementById("taskModalEyebrow").textContent = id ? "Editar demanda" : "Nova demanda";
  document.getElementById("taskModalTitle").textContent = id ? "Editar tarefa" : "Criar tarefa";
  document.getElementById("taskSubmitBtn").textContent = id ? "Salvar alterações" : "Salvar demanda";

  if (id) {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    form.elements.title.value = task.title;
    form.elements.client.value = task.client;
    form.elements.priority.value = task.priority;
    form.elements.due.value = task.due.slice(0, 10);
    form.elements.owner.value = task.owner;
    form.elements.budget.value = task.budget || "";
    form.elements.description.value = task.description;
  }

  modal.showModal();
}

function openClientEditor(id = null) {
  const form = document.getElementById("clientForm");
  const modal = document.getElementById("clientModal");
  form.reset();
  state.editingClientId = id;

  document.getElementById("clientModalEyebrow").textContent = id ? "Editar cliente" : "Novo cliente";
  document.getElementById("clientModalTitle").textContent = id ? "Editar contato" : "Cadastro do contato";
  document.getElementById("clientSubmitBtn").textContent = id ? "Salvar alterações" : "Criar cliente";

  if (id) {
    const client = clients.find((item) => item.id === id);
    if (!client) return;
    form.elements.name.value = client.name;
  }

  modal.showModal();
}

function openTeamEditor(index = null) {
  const form = document.getElementById("teamForm");
  const modal = document.getElementById("teamModal");
  form.reset();
  state.editingTeamIndex = index;

  document.getElementById("teamModalEyebrow").textContent = index !== null ? "Editar designer" : "Novo designer";
  document.querySelector("#teamModal .panel-head h2").textContent = index !== null ? "Editar profissional" : "Adicionar à equipe";
  document.getElementById("teamSubmitBtn").textContent = index !== null ? "Salvar alterações" : "Adicionar designer";

  if (index !== null) {
    const member = team[index];
    if (!member) return;
    form.elements.name.value = member.name;
    form.elements.role.value = member.role;
  }

  modal.showModal();
}

function openTaskDetail(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return;
  const description = task.description || "Sem descrição adicionada.";

  document.getElementById("taskDetailContent").innerHTML = `
    <div class="panel-head">
      <div>
        <span class="eyebrow">${task.client}</span>
        <h2>${task.title}</h2>
      </div>
      <button class="icon-btn" onclick="document.getElementById('taskDetailModal').close()" aria-label="Fechar">×</button>
    </div>
    <div class="task-detail-grid">
      <section>
        <div class="task-meta detail-tags">
          <span class="tag ${priorityClass(task.priority)}">${task.priority}</span>
          <span class="tag">${task.status}</span>
          <span class="tag due ${isOverdue(task) ? "danger" : ""}">${dueLabel(task)}</span>
          <span class="tag">${task.owner}</span>
        </div>
        <div class="briefing-summary">
          <div><span>Demanda</span><strong>${task.title}</strong></div>
          <div><span>Criada</span><strong>${formatDueDate(task.created || task.due)}</strong></div>
          <div><span>Valor</span><strong>${money.format(task.budget || 0)}</strong></div>
          <div><span>Entrega</span><strong>${formatDueDate(task.due)}</strong></div>
        </div>
        <div class="briefing-text">
          <span>Briefing</span>
          <p>${description}</p>
        </div>
        <div class="task-progress big">
          <div><span style="width:${progressPercent(task)}%"></span></div>
          <strong>${progressPercent(task)}%</strong>
        </div>
        <div class="detail-actions">
          <button onclick="openTaskEditor('${task.id}')">Editar demanda</button>
          <button onclick="advanceTask('${task.id}')">Avançar status</button>
          <button onclick="markFinal('${task.id}')">Marcar entregue</button>
          <button class="danger-action" onclick="deleteTask('${task.id}')">Excluir demanda</button>
        </div>
      </section>
      <aside class="detail-side">
        <h3>Checklist</h3>
        ${task.checklist.map((item, index) => `
          <label class="check-row">
            <input type="checkbox" ${index < task.done ? "checked" : ""} onchange="toggleChecklist('${task.id}', ${index}, this.checked)" />
            <span>${item}</span>
          </label>
        `).join("")}
        <h3>Histórico</h3>
        <div class="history-list">
          ${task.comments.map((comment) => `<span>${comment}</span>`).join("")}
        </div>
      </aside>
    </div>
  `;
  const modal = document.getElementById("taskDetailModal");
  if (!modal.open) modal.showModal();
}

function advanceTask(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return;
  const current = statuses.indexOf(task.status);
  task.status = statuses[Math.min(current + 1, statuses.length - 1)];
  task.done = Math.min(task.checklist.length, Math.max(task.done + 1, statusProgress(task.status, task.checklist.length)));
  task.comments.push(`Status avançado para ${task.status}`);
  renderAll();
  saveData();
  refreshTaskDetail(id);
  toast("Demanda avançada", `${task.title} foi movida para ${task.status}.`);
}

function markFinal(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return;
  task.status = "Entregue";
  task.done = task.checklist.length;
  task.comments.push("Entrega final marcada pelo ADM.");
  renderAll();
  saveData();
  refreshTaskDetail(id);
  toast("Entrega concluída", `${task.client} já pode baixar os arquivos finais.`);
}

function deleteTask(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return;
  const confirmed = window.confirm(`Excluir a demanda "${task.title}"? Essa ação remove a tarefa do quadro.`);
  if (!confirmed) return;

  tasks = tasks.filter((item) => item.id !== id);
  if (state.editingTaskId === id) state.editingTaskId = null;
  closeModal("taskDetailModal");
  closeModal("taskModal");
  populateClientSelects();
  saveData();
  renderAll();
  toast("Demanda excluída", `${task.title} foi removida do quadro.`);
}

function deleteTeamMember(index) {
  const member = team[index];
  if (!member) return;
  const assignedTasks = tasks.filter((task) => task.owner === member.name).length;
  const suffix = assignedTasks
    ? ` ${assignedTasks} demanda(s) continuarão com esse responsável no histórico.`
    : "";
  const confirmed = window.confirm(`Excluir "${member.name}" da equipe?${suffix}`);
  if (!confirmed) return;

  team.splice(index, 1);
  populateTeamOwners();
  saveData();
  renderTeam();
  toast("Designer excluído", `${member.name} foi removido da equipe.`);
}

function deleteClient(id) {
  const clientIndex = clients.findIndex((item) => item.id === id);
  const client = clients[clientIndex];
  if (!client) return;
  const linkedTasks = tasks.filter((task) => task.client === client.name).length;
  const suffix = linkedTasks
    ? ` ${linkedTasks} demanda(s) continuarão com esse cliente no histórico.`
    : "";
  const confirmed = window.confirm(`Excluir "${client.name}" dos clientes?${suffix}`);
  if (!confirmed) return;

  clients.splice(clientIndex, 1);
  if (state.client === client.name) state.client = "all";
  if (state.editingClientId === id) state.editingClientId = null;
  closeModal("clientModal");
  populateClientSelects();
  saveData();
  renderAll();
  toast("Cliente excluído", `${client.name} foi removido da lista de clientes.`);
}

function toggleChecklist(id, index, checked) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return;
  task.done = checked ? Math.max(task.done, index + 1) : Math.min(task.done, index);
  task.comments.push(`Checklist atualizado: ${task.done}/${task.checklist.length}`);
  renderAll();
  saveData();
  refreshTaskDetail(id);
}

function refreshTaskDetail(id) {
  if (document.getElementById("taskDetailModal").open) {
    openTaskDetail(id);
  }
}

function notifyUpcomingTasks() {
  const upcoming = [...tasks]
    .filter((task) => {
      if (task.status === "Entregue") return false;
      const diffDays = Math.ceil((startOfDay(task.due) - todayStart()) / 86400000);
      return diffDays >= 0 && diffDays <= 2;
    })
    .sort((a, b) => startOfDay(a.due) - startOfDay(b.due));

  if (!upcoming.length) {
    toast("Sistema pronto", "Nenhuma tarefa com entrega próxima nos próximos 2 dias.");
    return;
  }

  const preview = upcoming
    .slice(0, 3)
    .map((task) => `${task.title} (${dueLabel(task)})`)
    .join(" • ");
  const extra = upcoming.length > 3 ? ` +${upcoming.length - 3} tarefa(s)` : "";

  setTimeout(() => {
    toast("Entregas próximas", `${upcoming.length} tarefa(s) precisam de atenção: ${preview}${extra}.`, 9000);
  }, 600);
}

function dueDate(value) {
  const raw = String(value || "");
  const [datePart, timePart] = raw.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  if (timePart) {
    const [hour = 12, minute = 0] = timePart.split(":").map(Number);
    return new Date(year, month - 1, day, hour, minute);
  }
  return new Date(year, month - 1, day, 12, 0);
}

function startOfDay(value) {
  const day = dueDate(value);
  day.setHours(0, 0, 0, 0);
  return day;
}

function todayStart() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function formatDueDate(value) {
  return date.format(dueDate(value));
}

function columnSubtitle(status) {
  const subtitles = {
    Pendente: "briefing e entrada",
    "Em andamento": "produção criativa",
    "Em aprovação": "cliente avaliando",
    "Revisão solicitada": "ajustes pendentes",
    Entregue: "concluídas"
  };
  return subtitles[status] || "";
}

function normalizeTaskStatuses() {
  tasks.forEach((task) => {
    if (["Aprovado", "Finalizado"].includes(task.status)) task.status = "Entregue";
    if (!statuses.includes(task.status)) task.status = "Pendente";
  });
}

function progressPercent(task) {
  return Math.round((task.done / Math.max(task.checklist.length, 1)) * 100);
}

function statusProgress(status, total) {
  const map = {
    Pendente: 0,
    "Em andamento": 1,
    "Em aprovação": Math.max(1, total - 1),
    "Revisão solicitada": Math.max(1, total - 1),
    Entregue: total
  };
  return map[status] || 0;
}

function isOverdue(task) {
  return startOfDay(task.due) < todayStart() && task.status !== "Entregue";
}

function isToday(value) {
  return startOfDay(value).getTime() === todayStart().getTime();
}

function dueLabel(task) {
  const due = startOfDay(task.due);
  const diffMs = due - todayStart();
  const diffDays = Math.ceil(diffMs / 86400000);
  if (task.status === "Entregue") return "Entregue";
  if (diffDays < 0) return `${Math.abs(diffDays)}d atraso`;
  if (diffDays === 0) return "vence hoje";
  if (diffDays === 1) return "vence amanhã";
  return `${diffDays}d restantes`;
}

function urgencyScore(task) {
  const priority = { Alta: 40, Média: 22, Baixa: 10 }[task.priority] || 0;
  const overdue = isOverdue(task) ? 80 : 0;
  const revision = task.status === "Revisão solicitada" ? 45 : 0;
  const duePoints = Math.max(0, 20 - Math.ceil((startOfDay(task.due) - todayStart()) / 86400000));
  return priority + overdue + revision + duePoints;
}

function priorityClass(priority) {
  return priority.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function defaultChecklist() {
  return ["Briefing", "Criação", "Aprovação"];
}

function initials(name) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function createId() {
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

function toast(title, message, duration = 4200) {
  const stack = document.getElementById("toastStack");
  const item = document.createElement("div");
  item.className = "toast";
  item.innerHTML = `<strong>${title}</strong><p>${message}</p>`;
  stack.appendChild(item);
  notifyWindows(title, message);
  setTimeout(() => item.remove(), duration);
}

function notifyWindows(title, message) {
  window.designTarefasNotifications?.show({ title, body: message });
}
