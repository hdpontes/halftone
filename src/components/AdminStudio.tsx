"use client";

import { FormEvent, useState } from "react";
import "../app/admin-studio.css";

type Role = "ADMIN" | "MEMBER";
type AccessStatus = "ACTIVE" | "PENDING" | "SUSPENDED";
type AdminUser = { id: string; name: string; email: string; role: Role; accessStatus: AccessStatus; createdAt: string };

const STATUS_LABEL: Record<AccessStatus, string> = { ACTIVE: "Ativo", PENDING: "Pendente", SUSPENDED: "Suspenso" };

export default function AdminStudio({ initialUsers, currentUserId }: { initialUsers: AdminUser[]; currentUserId: string }) {
  const [users, setUsers] = useState<AdminUser[]>(initialUsers);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("MEMBER");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const total = users.length;
  const active = users.filter((u) => u.accessStatus === "ACTIVE").length;
  const pending = users.filter((u) => u.accessStatus === "PENDING").length;
  const suspended = users.filter((u) => u.accessStatus === "SUSPENDED").length;

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!name.trim() || !email.trim() || !password) {
      setError("Preencha nome, email e senha.");
      return;
    }
    setCreating(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Não foi possível criar o usuário.");
        return;
      }
      setUsers((prev) => [{ id: data.id, name, email: email.toLowerCase(), role, accessStatus: "ACTIVE", createdAt: data.createdAt }, ...prev]);
      setName("");
      setEmail("");
      setPassword("");
      setRole("MEMBER");
      setSuccess("Usuário criado com sucesso.");
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleStatus(user: AdminUser) {
    const nextStatus: AccessStatus = user.accessStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    setBusyId(user.id);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (response.ok) setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, accessStatus: nextStatus } : u)));
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(user: AdminUser) {
    const newPassword = window.prompt(`Nova senha para ${user.name} (mínimo 6 caracteres):`);
    if (!newPassword) return;
    if (newPassword.length < 6) {
      window.alert("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    setBusyId(user.id);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await response.json().catch(() => ({}));
      window.alert(response.ok ? "Senha atualizada com sucesso." : data.error || "Não foi possível atualizar a senha.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteUser(user: AdminUser) {
    if (user.id === currentUserId) return;
    if (!window.confirm(`Excluir o usuário ${user.name}? Essa ação não pode ser desfeita.`)) return;
    setBusyId(user.id);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      if (response.ok) setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="adm-root">
      <div className="adm-session-bar" aria-label="Sessão de acesso">
        <span>Painel <b>admin</b></span>
        <a href="/api/auth/logout">SAIR</a>
      </div>
      <div className="adm-app">
        <aside className="adm-side">
          <div className="adm-brand">
            <div className="adm-logo">AD</div>
            <div>
              <h1>Admin Studio</h1>
              <div className="adm-sub">controle de acesso dos usuários</div>
            </div>
          </div>
          <a className="adm-back" href="/halftone">← Voltar à ferramenta</a>

          <div className="adm-section">
            <div className="adm-section-title">Novo usuário</div>
            <form className="adm-form" onSubmit={createUser}>
              <label>
                Nome
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome completo" />
              </label>
              <label>
                Email
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@exemplo.com" />
              </label>
              <label>
                Senha
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha de acesso" />
              </label>
              <label>
                Papel
                <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
                  <option value="MEMBER">Membro</option>
                  <option value="ADMIN">Administrador</option>
                </select>
              </label>
              {error && <div className="adm-message adm-error">{error}</div>}
              {success && <div className="adm-message adm-success">{success}</div>}
              <button className="adm-primary" type="submit" disabled={creating}>
                {creating ? "Criando..." : "Adicionar usuário"}
              </button>
            </form>
          </div>
        </aside>

        <main className="adm-main">
          <div className="adm-top">
            <div>
              <div className="adm-title">Usuários</div>
              <div className="adm-status">Gerencie os acessos liberados na plataforma.</div>
            </div>
            <div className="adm-stats">
              <div className="adm-stat"><span>{total}</span>Total</div>
              <div className="adm-stat adm-stat-ok"><span>{active}</span>Ativos</div>
              <div className="adm-stat adm-stat-warn"><span>{pending}</span>Pendentes</div>
              <div className="adm-stat adm-stat-danger"><span>{suspended}</span>Suspensos</div>
            </div>
          </div>

          <div className="adm-table">
            <div className="adm-table-head">
              <span>Usuário</span>
              <span>Papel</span>
              <span>Status</span>
              <span>Cadastro</span>
              <span>Ações</span>
            </div>
            <div className="adm-table-body">
              {users.map((user) => (
                <div className="adm-row" key={user.id}>
                  <div className="adm-user-cell">
                    <strong>{user.name}</strong>
                    <small>{user.email}</small>
                  </div>
                  <span className={`adm-role adm-role-${user.role.toLowerCase()}`}>{user.role === "ADMIN" ? "Admin" : "Membro"}</span>
                  <span className={`adm-badge adm-badge-${user.accessStatus.toLowerCase()}`}>{STATUS_LABEL[user.accessStatus]}</span>
                  <time>{new Date(user.createdAt).toLocaleDateString("pt-BR")}</time>
                  <div className="adm-actions">
                    <button className="adm-smallBtn" disabled={busyId === user.id} onClick={() => toggleStatus(user)}>
                      {user.accessStatus === "ACTIVE" ? "Suspender" : "Ativar"}
                    </button>
                    <button className="adm-smallBtn" disabled={busyId === user.id} onClick={() => resetPassword(user)} title="Definir uma nova senha para o usuário">
                      Nova senha
                    </button>
                    <button
                      className="adm-smallBtn adm-smallBtn-danger"
                      disabled={busyId === user.id || user.id === currentUserId}
                      onClick={() => deleteUser(user)}
                      title={user.id === currentUserId ? "Você não pode excluir o próprio usuário" : "Excluir usuário"}
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              ))}
              {users.length === 0 && <div className="adm-empty">Nenhum usuário cadastrado.</div>}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
