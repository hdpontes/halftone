import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <main className="app-shell tool-home"><nav className="topbar"><div className="brand-mark">H<span>.</span></div><div className="nav-user"><span className="avatar">{session.name[0]}</span><span>{session.name}</span><a href="/api/auth/logout">Sair</a></div></nav><section className="tool-home-content"><div className="tool-home-intro"><p className="eyebrow muted">HPBOOST / DTF TOOLS</p><h1>Seu espaço<br /><em>de produção.</em></h1><p>Ferramentas precisas para transformar arte em arquivo pronto para estamparia.</p></div><div className="tool-launch"><div className="tool-launch-top"><span>01 / HALFTONE</span><span className="tool-status"><i /> DISPONÍVEL</span></div><div><h2>Retícula de precisão.</h2><p>Controle LPI, ângulo, ponto, contraste e saída para preparar sua arte DTF.</p></div><a className="button button-light" href="/halftone">Abrir ferramenta <span>↗</span></a><strong className="tool-launch-index">01</strong></div><div className="tool-home-footer"><span>MAIS FERRAMENTAS EM BREVE</span><span>HPBOOST © 2026</span></div></section></main>;
}
