"use client";
import { FormEvent, useState } from "react";
import Link from "next/link";
import "../login-studio.css";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccess(false);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (response.ok) {
      setSuccess(true);
      window.location.href = "/halftone";
    } else {
      setError((await response.json()).error || "Não foi possível entrar.");
      setLoading(false);
    }
  }

  return (
    <div className="login-studio">
      <Link className="back-link" href="/">← Voltar para o site</Link>
      <main className="ls-shell">
        <section className="ls-showcase">
          <div>
            <img className="ls-logo-img" src="/assets/logo.png" alt="Halftone Online Pro" />
            <div className="tag">Área exclusiva de acesso</div>
            <h1>Halftone profissional direto no navegador.</h1>
            <p className="lead">Entre com seus dados e crie halftones para fundo escuro, colorido ou claro direto no navegador, sem instalar programas.</p>
            <div className="benefits">
              <div className="benefit"><b>✓</b> Fundo escuro</div>
              <div className="benefit"><b>✓</b> Fundo colorido</div>
              <div className="benefit"><b>✓</b> Fundo claro</div>
              <div className="benefit"><b>✓</b> Exportação em alta qualidade</div>
            </div>
          </div>
          <p className="small-note">HALFTONE ONLINE PRO • Acesso exclusivo para assinantes</p>
        </section>

        <section className="ls-login-side">
          <div className="ls-login-card">
            <h2>Entrar na ferramenta</h2>
            <p>Digite seu e-mail e senha de acesso para abrir o Halftone Online Pro.</p>

            <form onSubmit={submit} autoComplete="on" noValidate>
              <div className="field">
                <label htmlFor="email">E-mail</label>
                <div className="input-wrap">
                  <input id="email" name="email" type="email" autoComplete="username" placeholder="voce@email.com" required autoFocus />
                </div>
              </div>

              <div className="field">
                <label htmlFor="password">Senha</label>
                <div className="input-wrap">
                  <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Digite sua senha" required />
                  <button className="toggle" type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>
                    {showPassword ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
              </div>

              <button className="submit" type="submit" disabled={loading}>
                {loading ? "VERIFICANDO..." : "ACESSAR FERRAMENTA"}
              </button>

              {error && <div className="message error" role="alert">{error}</div>}
              {success && <div className="message success">Acesso liberado. Abrindo a ferramenta...</div>}
            </form>

            <a className="ls-signup" href="/checkout">Ainda não tem acesso? Assinar agora</a>

            <div className="secure-note">
              <span>●</span>
              <span>Use os dados de acesso da sua conta. A ferramenta funciona no celular e no computador.</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
