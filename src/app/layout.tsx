import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Halftone | Sua próxima fase começa aqui", description: "Área exclusiva de alunos Halftone" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }