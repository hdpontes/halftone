"use client";
import { CSSProperties, FormEvent, useState } from "react";

// Mandatory password change modal — no close/dismiss action while `forceOpen` is true.
export default function ChangePasswordModal({ forceOpen }: { forceOpen: boolean }) {
  const [open, setOpen] = useState(forceOpen);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newPassword.length < 6) return setError("A nova senha deve ter pelo menos 6 caracteres.");
    if (newPassword !== confirmPassword) return setError("As senhas não coincidem.");
    setLoading(true);
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (response.ok) {
      setOpen(false);
      window.location.reload();
    } else {
      setError((await response.json()).error || "Não foi possível trocar a senha.");
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.65)",
      }}
    >
      <form
        onSubmit={submit}
        style={{
          background: "#161616",
          color: "#f2f2f2",
          padding: "28px",
          borderRadius: "12px",
          width: "min(360px, 92vw)",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Troque sua senha temporária</h2>
        <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.8 }}>
          Por segurança, defina uma senha pessoal antes de continuar.
        </p>
        <input
          type="password"
          placeholder="Senha temporária"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Nova senha"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Confirmar nova senha"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          style={inputStyle}
        />
        {error && <div style={{ color: "#ff6b6b", fontSize: "0.85rem" }}>{error}</div>}
        <button type="submit" disabled={loading} style={buttonStyle}>
          {loading ? "Salvando..." : "Salvar nova senha"}
        </button>
      </form>
    </div>
  );
}

const inputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #333",
  background: "#0d0d0d",
  color: "#f2f2f2",
};

const buttonStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: "8px",
  border: "none",
  background: "#f2b705",
  color: "#161616",
  fontWeight: 600,
  cursor: "pointer",
};
