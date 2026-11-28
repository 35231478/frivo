"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { SENHA_MINIMA, problemaSenha } from "@/lib/acesso/senha";
import { RequisitosSenha } from "@/components/auth/requisitos-senha";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ErrosDoFormulario, ResumoDeErros, useErrosDoFormulario } from "@/components/ui/formulario-erros";

type Finalidade = "convite" | "recuperacao";

export function DefinirSenhaForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [conferindo, setConferindo] = useState(true);
  // convite (Configurações › Usuários) ou recuperação ("Esqueci minha senha"): muda só o texto
  const [usuario, setUsuario] = useState<{ nome: string; email: string; finalidade?: Finalidade } | null>(null);
  const [erroLink, setErroLink] = useState("");
  const [finalidadeErro, setFinalidadeErro] = useState<Finalidade>("convite");
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mostrar, setMostrar] = useState(false);
  // ERRO NO CAMPO: senha fraca na senha, confirmação diferente na confirmação; link vencido/conexão na faixa
  const erros = useErrosDoFormulario();
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!token) { setErroLink("Link inválido. Peça um novo convite ao administrador."); setConferindo(false); return; }
    fetch(`/api/publico/definir-senha?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.ok) setUsuario(d);
        else { setErroLink(d.erro ?? "Link inválido."); if (d.finalidade === "recuperacao") setFinalidadeErro("recuperacao"); }
      })
      .catch(() => setErroLink("Erro de conexão."))
      .finally(() => setConferindo(false));
  }, [token]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const problema = problemaSenha(senha);
    if (!erros.validar(problema ? { senha: problema } : senha !== confirmar ? { confirmar: "A confirmação não confere com a senha." } : {})) return;
    setSalvando(true);
    try {
      const r = await fetch("/api/publico/definir-senha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, senha, confirmar }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { erros.erroDaApi(d, "Não foi possível definir a senha."); return; }
      router.push(`/login?senha=definida&email=${encodeURIComponent(d.email ?? "")}`);
    } catch { erros.definirGeral("Erro de conexão."); erros.focar(); } finally { setSalvando(false); }
  }

  if (conferindo) return <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="w-4 h-4 animate-spin" /> Conferindo o link…</p>;
  if (erroLink) return (
    <div className="space-y-3">
      <h2 className="text-xl font-bold text-ink">{finalidadeErro === "recuperacao" ? "Criar nova senha" : "Definir senha"}</h2>
      <p role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2.5 flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {erroLink}</p>
      {finalidadeErro === "recuperacao" && (
        <Link href="/esqueci-senha" className="inline-block text-sm font-semibold text-primary-600 hover:text-primary-700">Pedir um novo link</Link>
      )}
    </div>
  );

  const recuperacao = usuario?.finalidade === "recuperacao";

  return (
    <ErrosDoFormulario valor={erros}>
    <form ref={erros.ref} onSubmit={salvar} className="space-y-5" noValidate>
      <div>
        <h2 className="text-xl font-bold text-ink">{recuperacao ? "Criar nova senha" : `Defina sua senha, ${usuario?.nome?.split(" ")[0]}`}</h2>
        <p className="text-sm text-ink-muted mt-1">
          {recuperacao ? <>Defina uma nova senha para <strong>{usuario?.email}</strong>. Ao salvar, as sessões abertas com a senha antiga são encerradas.</>
            : <>Defina a senha de acesso para <strong>{usuario?.email}</strong>.</>}
        </p>
      </div>
      <ResumoDeErros className="py-2.5 px-3" />
      <FormField label="Nova senha" name="senha">
        <div className="relative">
          <Input type={mostrar ? "text" : "password"} value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" className="pr-12 min-h-[44px]" placeholder={`Pelo menos ${SENHA_MINIMA} caracteres, com letra e número`} />
          <button type="button" onClick={() => setMostrar((v) => !v)} className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 inline-flex items-center justify-center text-ink-subtle" aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"}>
            {mostrar ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <RequisitosSenha senha={senha} className="pt-1" />
      </FormField>
      <FormField label="Confirme a senha" name="confirmar">
        <Input type={mostrar ? "text" : "password"} value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" className="min-h-[44px]" />
      </FormField>
      <button type="submit" disabled={salvando} className="w-full inline-flex items-center justify-center gap-2 bg-acento hover:bg-acento-hover text-white font-semibold rounded-lg py-2.5 disabled:opacity-60">
        {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {recuperacao ? "Salvar nova senha" : "Definir senha e entrar"}
      </button>
    </form>
    </ErrosDoFormulario>
  );
}
