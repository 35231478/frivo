"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Check, Eye, EyeOff, Loader2 } from "lucide-react";

const MIN = 8;

export function DefinirSenhaForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [conferindo, setConferindo] = useState(true);
  const [usuario, setUsuario] = useState<{ nome: string; email: string } | null>(null);
  const [erroLink, setErroLink] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!token) { setErroLink("Link inválido. Peça um novo convite ao administrador."); setConferindo(false); return; }
    fetch(`/api/publico/definir-senha?token=${encodeURIComponent(token)}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (r.ok) setUsuario(d); else setErroLink(d.erro ?? "Link inválido."); })
      .catch(() => setErroLink("Erro de conexão."))
      .finally(() => setConferindo(false));
  }, [token]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (senha.length < MIN) { setErro(`A senha precisa ter pelo menos ${MIN} caracteres.`); return; }
    if (senha !== confirmar) { setErro("A confirmação não confere com a senha."); return; }
    setSalvando(true);
    try {
      const r = await fetch("/api/publico/definir-senha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, senha, confirmar }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível definir a senha."); return; }
      router.push(`/login?senha=definida&email=${encodeURIComponent(d.email ?? "")}`);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  if (conferindo) return <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="w-4 h-4 animate-spin" /> Conferindo o convite…</p>;
  if (erroLink) return (
    <div className="space-y-3">
      <h2 className="text-xl font-bold text-ink">Definir senha</h2>
      <p role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2.5 flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {erroLink}</p>
    </div>
  );

  const cls = "w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10";
  return (
    <form onSubmit={salvar} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-ink">Olá, {usuario?.nome?.split(" ")[0]}!</h2>
        <p className="text-sm text-ink-muted mt-1">Defina a senha de acesso para <strong>{usuario?.email}</strong>.</p>
      </div>
      {erro && <p role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2.5 flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {erro}</p>}
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-ink">Nova senha</span>
        <div className="relative">
          <input type={mostrar ? "text" : "password"} value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" className={cls} placeholder={`Pelo menos ${MIN} caracteres`} />
          <button type="button" onClick={() => setMostrar((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle" aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"}>
            {mostrar ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-ink">Confirme a senha</span>
        <input type={mostrar ? "text" : "password"} value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" className={cls} />
      </label>
      <button type="submit" disabled={salvando} className="w-full inline-flex items-center justify-center gap-2 bg-success-500 hover:bg-success-600 text-white font-semibold rounded-lg py-2.5 disabled:opacity-60">
        {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Definir senha e entrar
      </button>
    </form>
  );
}
