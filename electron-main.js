const { app, BrowserWindow, Menu, Notification, ipcMain, shell } = require("electron");
const fs = require("fs/promises");
const path = require("path");
const dotenv = require("dotenv");
const initSqlJs = require("sql.js");
const { Pool } = require("pg");
const { autoUpdater } = require("electron-updater");
const appMetadata = require("./package.json");

app.setName("DESIGN TAREFAS");
app.setAppUserModelId("br.com.designtarefas.app");

const databaseFileName = "design-tarefas.sqlite";
const legacyDatabaseFileName = "design-tarefas-database.json";
let mainWindow = null;
let isQuitting = false;
let sqlModulePromise = null;
let sqliteDatabasePromise = null;
let supabasePool = null;
let supabaseSchemaPromise = null;
let databaseWriteQueue = Promise.resolve();
let environmentLoaded = false;
let updateCheckStarted = false;
let closeInProgress = false;

const shutdownWriteTimeoutMs = 1500;
const shutdownPoolTimeoutMs = 700;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

function loadEnvironment() {
  if (environmentLoaded) return;
  environmentLoaded = true;

  const environmentPaths = [
    path.join(process.cwd(), ".env"),
    path.join(__dirname, ".env"),
    process.resourcesPath ? path.join(process.resourcesPath, ".env") : null,
    process.resourcesPath ? path.join(process.resourcesPath, "app.env") : null,
    process.execPath ? path.join(path.dirname(process.execPath), ".env") : null,
    app.isReady() ? path.join(app.getPath("userData"), ".env") : null
  ].filter(Boolean);

  environmentPaths.forEach((environmentPath) => {
    dotenv.config({ path: environmentPath, override: false });
  });

  if (!process.env.DATABASE_URL && process.env.DESIGN_TAREFAS_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.DESIGN_TAREFAS_DATABASE_URL;
  }
}

function getSupabasePool() {
  loadEnvironment();
  if (!process.env.DATABASE_URL) return null;

  if (!supabasePool) {
    supabasePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }

  return supabasePool;
}

async function ensureSupabaseSchema() {
  const pool = getSupabasePool();
  if (!pool) return null;

  if (!supabaseSchemaPromise) {
    supabaseSchemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS public.users (
        id TEXT PRIMARY KEY,
        name TEXT,
        username TEXT,
        role TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        segment TEXT,
        active INTEGER NOT NULL DEFAULT 0,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.team (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        client TEXT,
        owner TEXT,
        status TEXT,
        priority TEXT,
        due_date DATE,
        created_date DATE,
        budget NUMERIC NOT NULL DEFAULT 0,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.budgets (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        client TEXT,
        amount NUMERIC NOT NULL DEFAULT 0,
        status TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.notifications (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        type TEXT,
        read BOOLEAN NOT NULL DEFAULT false,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.app_state (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  return supabaseSchemaPromise;
}

function normalizeRemotePayload(value) {
  if (!value || typeof value !== "object") return {};
  return value;
}

function rowPayload(row) {
  if (!row) return {};
  return normalizeRemotePayload(row.payload);
}

function latestRemoteTimestamp(...results) {
  const timestamps = results
    .flatMap((result) => result.rows || [])
    .map((row) => new Date(row.updated_at).getTime())
    .filter((value) => Number.isFinite(value));

  if (!timestamps.length) return new Date().toISOString();
  return new Date(Math.max(...timestamps)).toISOString();
}

function teamMemberId(member, index) {
  if (member?.id) return String(member.id);
  const base = String(member?.name || `member-${index + 1}`)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return base || `member-${index + 1}`;
}

function budgetId(task) {
  return `task-${task.id}`;
}

function notificationId(task, index) {
  return `task-${task.id}-${index + 1}`;
}

async function readSupabaseDatabase() {
  const pool = getSupabasePool();
  if (!pool) return null;

  await ensureSupabaseSchema();
  const [usersResult, clientsResult, teamResult, tasksResult, budgetsResult, notificationsResult, appStateResult] = await Promise.all([
    pool.query("SELECT * FROM public.users ORDER BY updated_at ASC"),
    pool.query("SELECT * FROM public.clients ORDER BY updated_at ASC"),
    pool.query("SELECT * FROM public.team ORDER BY updated_at ASC"),
    pool.query("SELECT * FROM public.tasks ORDER BY updated_at DESC"),
    pool.query("SELECT * FROM public.budgets ORDER BY updated_at DESC"),
    pool.query("SELECT * FROM public.notifications ORDER BY updated_at DESC"),
    pool.query("SELECT * FROM public.app_state WHERE id = $1 LIMIT 1", ["main"])
  ]);

  const authRow = usersResult.rows.find((row) => row.id === "auth");
  const stateRowsCount =
    usersResult.rowCount +
    clientsResult.rowCount +
    teamResult.rowCount +
    tasksResult.rowCount +
    budgetsResult.rowCount +
    notificationsResult.rowCount;

  if (!authRow && stateRowsCount === 0) {
    return appStateResult.rows[0]?.payload || null;
  }

  const authPayload = rowPayload(authRow);
  const appStatePayload = appStateResult.rows[0]?.payload || {};
  const savedAt = latestRemoteTimestamp(
    usersResult,
    clientsResult,
    teamResult,
    tasksResult,
    budgetsResult,
    notificationsResult,
    appStateResult
  );

  return {
    version: 2,
    savedAt,
    setupComplete: Boolean(authPayload.setupComplete),
    authUser: authPayload.authUser || null,
    users: Array.isArray(appStatePayload.users) ? appStatePayload.users : authPayload.users || [],
    activityLogs: Array.isArray(appStatePayload.activityLogs) ? appStatePayload.activityLogs : authPayload.activityLogs || [],
    rememberSession: Boolean(authPayload.rememberSession),
    rememberedLogin: authPayload.rememberedLogin || { enabled: false, user: "", password: "" },
    clients: clientsResult.rows.map(rowPayload),
    tasks: tasksResult.rows.map(rowPayload),
    team: teamResult.rows.map(rowPayload),
    budgets: budgetsResult.rows.map(rowPayload),
    notifications: notificationsResult.rows.map(rowPayload)
  };
}

async function writeSupabaseDatabase(data) {
  const pool = getSupabasePool();
  if (!pool) return null;

  await ensureSupabaseSchema();
  const payload = {
    version: 2,
    ...data,
    savedAt: new Date().toISOString()
  };

  const clients = Array.isArray(data.clients) ? data.clients : [];
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const team = Array.isArray(data.team) ? data.team : [];
  const budgets = Array.isArray(data.budgets) ? data.budgets : [];
  const notifications = Array.isArray(data.notifications) ? data.notifications : [];
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
        INSERT INTO public.users (id, name, username, role, payload, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (id) DO UPDATE SET
          name = excluded.name,
          username = excluded.username,
          role = excluded.role,
          payload = excluded.payload,
          updated_at = excluded.updated_at
      `,
      [
        "auth",
        data.authUser?.name || null,
        data.authUser?.user || null,
        data.authUser?.role || "ADM",
        {
          setupComplete: Boolean(data.setupComplete),
          authUser: data.authUser || null,
          users: Array.isArray(data.users) ? data.users : [],
          activityLogs: Array.isArray(data.activityLogs) ? data.activityLogs : [],
          rememberSession: Boolean(data.rememberSession),
          rememberedLogin: data.rememberedLogin || { enabled: false, user: "", password: "" }
        }
      ]
    );

    await replaceRemoteRows(client, "clients", clients, (item) => item.id, (item) => ({
      name: item.name || "Cliente sem nome",
      segment: item.segment || null,
      active: Number(item.active) || 0,
      payload: item
    }));

    await replaceRemoteRows(client, "team", team, teamMemberId, (item) => ({
      name: item.name || "Profissional sem nome",
      role: item.role || null,
      payload: item
    }));

    await replaceRemoteRows(client, "tasks", tasks, (item) => item.id, (item) => ({
      title: item.title || "Demanda sem titulo",
      client: item.client || null,
      owner: item.owner || null,
      status: item.status || null,
      priority: item.priority || null,
      due_date: item.due || null,
      created_date: item.created || null,
      budget: Number(item.budget) || 0,
      payload: item
    }));

    const budgetRows = budgets.length
      ? budgets
      : tasks
          .filter((task) => Number(task.budget) > 0)
          .map((task) => ({
            id: budgetId(task),
            taskId: task.id,
            client: task.client,
            amount: Number(task.budget) || 0,
            status: task.status,
            source: "task"
          }));

    await replaceRemoteRows(client, "budgets", budgetRows, (item) => item.id, (item) => ({
      task_id: item.taskId || item.task_id || null,
      client: item.client || null,
      amount: Number(item.amount ?? item.budget) || 0,
      status: item.status || null,
      payload: item
    }));

    const notificationRows = notifications.length
      ? notifications
      : tasks.flatMap((task) =>
          Array.isArray(task.comments)
            ? task.comments.map((comment, index) => ({
                id: notificationId(task, index),
                taskId: task.id,
                type: "Historico",
                read: true,
                message: comment
              }))
            : []
        );

    await replaceRemoteRows(client, "notifications", notificationRows, (item) => item.id, (item) => ({
      task_id: item.taskId || item.task_id || item.demandId || null,
      type: item.type || "Notificacao",
      read: Boolean(item.read),
      payload: item
    }));

    await client.query(
      `
        INSERT INTO public.app_state (id, payload, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (id) DO UPDATE SET
          payload = excluded.payload,
          updated_at = excluded.updated_at
      `,
      ["main", payload]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return payload;
}

async function replaceRemoteRows(client, tableName, rows, getId, mapColumns) {
  for (const [index, row] of rows.entries()) {
    const id = String(getId(row, index));
    if (!id) continue;

    const columns = mapColumns(row, index);
    await upsertRemoteRow(client, tableName, id, columns);
  }
}

async function upsertRemoteRow(client, tableName, id, columns) {
  const columnNames = ["id", ...Object.keys(columns), "updated_at"];
  const placeholders = columnNames.map((_, index) => (columnNames[index] === "updated_at" ? "now()" : `$${index + 1}`));
  const values = [id, ...Object.values(columns)];
  const updateColumns = Object.keys(columns)
    .map((column) => `${column} = excluded.${column}`)
    .concat("updated_at = excluded.updated_at")
    .join(", ");

  await client.query(
    `
      INSERT INTO public.${tableName} (${columnNames.join(", ")})
      VALUES (${placeholders.join(", ")})
      ON CONFLICT (id) DO UPDATE SET ${updateColumns}
    `,
    values
  );
}

function databasePath() {
  return path.join(app.getPath("userData"), databaseFileName);
}

function legacyDatabasePath() {
  return path.join(app.getPath("userData"), legacyDatabaseFileName);
}

async function ensureDatabaseDirectory() {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
}

function getSqlModule() {
  if (!sqlModulePromise) {
    sqlModulePromise = initSqlJs({
      locateFile: (file) => path.join(__dirname, "node_modules", "sql.js", "dist", file)
    });
  }

  return sqlModulePromise;
}

async function createDatabaseFromDisk() {
  const SQL = await getSqlModule();

  try {
    const content = await fs.readFile(databasePath());
    return new SQL.Database(content);
  } catch (error) {
    if (error.code === "ENOENT") return new SQL.Database();
    await backupCorruptedDatabase();
    return new SQL.Database();
  }
}

async function getSqliteDatabase() {
  if (!sqliteDatabasePromise) {
    sqliteDatabasePromise = (async () => {
      await ensureDatabaseDirectory();
      const database = await createDatabaseFromDisk();

      database.run(`
        CREATE TABLE IF NOT EXISTS app_state (
          id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      await migrateLegacyDatabase(database);
      return database;
    })();
  }

  return sqliteDatabasePromise;
}

async function migrateLegacyDatabase(database) {
  const existing = database.exec("SELECT id FROM app_state WHERE id = 'main' LIMIT 1");
  if (existing.length) return;

  try {
    const content = await fs.readFile(legacyDatabasePath(), "utf8");
    const legacyData = JSON.parse(content);
    const payload = JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      ...legacyData
    });

    database.run(
      "INSERT INTO app_state (id, payload, updated_at) VALUES (?, ?, ?)",
      ["main", payload, new Date().toISOString()]
    );

    await persistSqliteDatabase(database);
  } catch (error) {
    if (error.code === "ENOENT") return;
    if (error instanceof SyntaxError) {
      await backupCorruptedLegacyDatabase();
      return;
    }
    console.error("Falha ao migrar banco local antigo:", error);
  }
}

async function readDatabase() {
  let remoteData = null;
  let localData = null;

  try {
    remoteData = await readSupabaseDatabase();
  } catch (error) {
    console.error("Falha ao ler o banco Supabase:", error);
  }

  localData = await readLocalDatabase();

  if (remoteData && localData) {
    return stateTimestamp(remoteData) >= stateTimestamp(localData) ? remoteData : localData;
  }

  return remoteData || localData;
}

async function readLocalDatabase() {
  try {
    const database = await getSqliteDatabase();
    const result = database.exec("SELECT payload FROM app_state WHERE id = 'main' LIMIT 1");
    if (!result.length || !result[0].values.length) return null;
    return JSON.parse(result[0].values[0][0]);
  } catch (error) {
    if (error instanceof SyntaxError) {
      await backupCorruptedDatabase();
      return null;
    }
    console.error("Falha ao ler o banco local:", error);
    return null;
  }
}

function stateTimestamp(data) {
  const timestamp = Date.parse(data?.savedAt || data?.updated_at || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function readRemoteDatabase() {
  try {
    return await readSupabaseDatabase();
  } catch (error) {
    console.error("Falha ao ler o banco remoto:", error);
    return null;
  }
}

async function databaseStatus() {
  const pool = getSupabasePool();
  if (!pool) {
    return { remoteConfigured: false, remoteOnline: false };
  }

  try {
    await ensureSupabaseSchema();
    await pool.query("SELECT 1");
    return { remoteConfigured: true, remoteOnline: true };
  } catch (error) {
    console.error("Falha ao testar o banco remoto:", error);
    return { remoteConfigured: true, remoteOnline: false, message: error?.message || "Banco remoto indisponivel." };
  }
}

async function writeDatabase(data) {
  const database = await getSqliteDatabase();
  const payload = {
    version: 1,
    ...data,
    savedAt: new Date().toISOString()
  };
  const updatedAt = new Date().toISOString();

  database.run(
    `
      INSERT INTO app_state (id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `,
    ["main", JSON.stringify(payload), updatedAt]
  );

  await persistSqliteDatabase(database);

  try {
    await writeSupabaseDatabase(data);
  } catch (error) {
    console.error("Falha ao salvar no banco Supabase:", error);
  }

  return payload;
}

function waitWithTimeout(promise, timeoutMs) {
  let timeoutId = null;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
    if (typeof timeoutId.unref === "function") timeoutId.unref();
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function queueWriteDatabase(data) {
  databaseWriteQueue = databaseWriteQueue
    .catch(() => null)
    .then(() => writeDatabase(data));
  return databaseWriteQueue;
}

async function flushDatabaseWrites(timeoutMs = shutdownWriteTimeoutMs) {
  try {
    await waitWithTimeout(databaseWriteQueue, timeoutMs);
  } catch (error) {
    console.error("Falha ao aguardar salvamento pendente:", error);
  }
}

async function closeSupabasePool(timeoutMs = shutdownPoolTimeoutMs) {
  if (!supabasePool) return;

  const pool = supabasePool;
  supabasePool = null;
  supabaseSchemaPromise = null;

  try {
    await waitWithTimeout(pool.end(), timeoutMs);
  } catch (error) {
    console.error("Falha ao encerrar conexao remota:", error);
  }
}

async function closeAppGracefully() {
  if (closeInProgress) return;
  closeInProgress = true;
  isQuitting = true;

  await flushDatabaseWrites();
  await closeSupabasePool();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }

  app.quit();

  setTimeout(() => {
    if (!app.isQuitting) app.exit(0);
  }, 800).unref?.();
}

async function persistSqliteDatabase(database) {
  await ensureDatabaseDirectory();
  const targetPath = databasePath();
  const tempPath = `${targetPath}.tmp`;
  await fs.writeFile(tempPath, Buffer.from(database.export()));
  await fs.rename(tempPath, targetPath);
}

async function backupCorruptedDatabase() {
  const sourcePath = databasePath();
  const backupPath = `${sourcePath}.corrompido-${Date.now()}.bak`;

  try {
    await fs.rename(sourcePath, backupPath);
    console.error(`Banco local corrompido movido para: ${backupPath}`);
  } catch (error) {
    console.error("Falha ao criar backup do banco local corrompido:", error);
  }
}

async function backupCorruptedLegacyDatabase() {
  const sourcePath = legacyDatabasePath();
  const backupPath = `${sourcePath}.corrompido-${Date.now()}.bak`;

  try {
    await fs.rename(sourcePath, backupPath);
    console.error(`Banco local antigo corrompido movido para: ${backupPath}`);
  } catch (error) {
    console.error("Falha ao criar backup do banco local antigo corrompido:", error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "DESIGN TAREFAS",
    icon: path.join(__dirname, "build", "icon.ico"),
    frame: false,
    thickFrame: false,
    titleBarStyle: "hidden",
    show: false,
    backgroundColor: "#070910",
    backgroundMaterial: "none",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
  });
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    closeAppGracefully();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function showMainWindow() {
  if (!mainWindow) createWindow();
  mainWindow.show();
  mainWindow.focus();
}

function showWindowsNotification({ title, body }) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!Notification.isSupported()) return;

  if (typeof shell.beep === "function") shell.beep();
  const notification = new Notification({
    title: title || "DESIGN TAREFAS",
    body: body || "Voce tem uma notificacao.",
    icon: path.join(__dirname, "build", "icon.ico"),
    silent: false
  });
  notification.on("click", showMainWindow);
  notification.show();
}

function sendUpdateStatus(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("updates:status", payload);
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatus({ type: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    sendUpdateStatus({ type: "available", version: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    updateCheckStarted = false;
    sendUpdateStatus({ type: "not-available" });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendUpdateStatus({ type: "downloading", percent: Math.round(progress.percent || 0) });
  });

  autoUpdater.on("update-downloaded", (info) => {
    updateCheckStarted = false;
    sendUpdateStatus({ type: "downloaded", version: info.version });
  });

  autoUpdater.on("error", (error) => {
    updateCheckStarted = false;
    sendUpdateStatus({ type: "error", message: error?.message || "Falha ao verificar atualizacao." });
  });
}

function checkForUpdates() {
  if (!app.isPackaged) {
    sendUpdateStatus({ type: "disabled-dev" });
    return false;
  }

  if (updateCheckStarted) return true;
  updateCheckStarted = true;
  autoUpdater.checkForUpdates().catch((error) => {
    sendUpdateStatus({ type: "error", message: error?.message || "Falha ao verificar atualizacao." });
  });
  return true;
}

if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    if (!mainWindow) {
      createWindow();
      return;
    }

    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    setupAutoUpdater();

    ipcMain.handle("database:load", readDatabase);
    ipcMain.handle("database:load-remote", readRemoteDatabase);
    ipcMain.handle("database:save", (_event, data) => queueWriteDatabase(data));
    ipcMain.handle("database:path", () => databasePath());
    ipcMain.handle("database:status", databaseStatus);
    ipcMain.handle("app:info", () => ({
      name: appMetadata.productName || app.getName(),
      version: app.getVersion(),
      description: appMetadata.description || ""
    }));
    ipcMain.handle("window:minimize", () => mainWindow?.minimize());
    ipcMain.handle("window:maximize", () => {
      if (!mainWindow) return false;
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
        return false;
      }
      mainWindow.maximize();
      return true;
    });
    ipcMain.handle("window:close", closeAppGracefully);
    ipcMain.handle("app:quit", closeAppGracefully);
    ipcMain.handle("notifications:show", (_event, payload) => showWindowsNotification(payload || {}));
    ipcMain.handle("updates:check", () => checkForUpdates());
    ipcMain.handle("updates:install", async () => {
      isQuitting = true;
      await flushDatabaseWrites();
      await closeSupabasePool();
      autoUpdater.quitAndInstall(false, true);
    });

    createWindow();
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(checkForUpdates, 5000);
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  app.quit();
});
