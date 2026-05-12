# DESIGN TAREFAS

Sistema web premium para gestão de uma agência de design gráfico e eventos.

## Como abrir agora no navegador

Abra `index.html` diretamente no navegador. A interface funciona sem build e inclui:

- Painel ADM com métricas, gráficos, alertas e calendário.
- Kanban com arrastar demandas entre status.
- Cadastro de clientes e demandas.
- Aprovação, revisão, orçamento e lembretes controlados internamente.
- Equipe e permissões.
- Modo escuro/claro e layout responsivo.

## Programa instalavel para Windows

O projeto tambem pode virar um programa de Windows com Electron. Os dados ficam salvos localmente na maquina em SQLite e, quando `DATABASE_URL` estiver configurado, tambem sao sincronizados com o Supabase.

```text
%APPDATA%\DESIGN TAREFAS\design-tarefas.sqlite
```

Esse arquivo guarda clientes, tarefas e equipe como backup local. Ao fechar e abrir o programa, as informacoes continuam salvas mesmo sem internet. Quando houver conexao com o Supabase, o app carrega e salva nas tabelas separadas:

- `public.users`
- `public.clients`
- `public.tasks`
- `public.team`
- `public.budgets`
- `public.notifications`

A tabela `public.app_state` continua existindo apenas como compatibilidade/migracao do formato antigo.

### Configurar Supabase no app instalado

Crie um arquivo `.env` em:

```text
%APPDATA%\DESIGN TAREFAS\.env
```

Com este conteudo:

```env
DATABASE_URL=postgresql://postgres:SUA_SENHA@db.SEUPROJETO.supabase.co:5432/postgres
```

Se a senha tiver caracteres especiais, use a versao codificada na URL. Exemplo: `@` vira `%40`.

Por seguranca, nao coloque a senha real do banco dentro do instalador que sera distribuido para outras pessoas. Para uso profissional com varios computadores/clientes, coloque essa senha somente em um servidor/API e faca o app conversar com a API por HTTPS.

### Gerar o instalador

Instale o Node.js LTS no Windows e depois rode:

```bash
npm install
npm run build:win
```

O instalador `.exe` sera criado na pasta `dist`.

### Rodar em modo aplicativo sem gerar instalador

```bash
npm install
npm run dev
```

## Backend opcional

Quando o Node.js estiver instalado:

```bash
npm install
npm run web
```

A API sobe em `http://localhost:3333` e já possui rotas base para:

- Login com JWT.
- Demandas.
- Aprovação e revisão registradas pela equipe.
- Notificações.

## Integrações futuras

Pontos naturais para plugar produção:

- PostgreSQL no lugar dos arrays em memória.
- Firebase Cloud Messaging ou WebSocket para notificações em tempo real.
