"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { cn } from "@/lib/utils";
import { User, Camera, Lock, Building2, ShieldCheck, FileCheck, AlertCircle, Briefcase } from "lucide-react";

interface Initial {
  nome: string;
  email: string;
  avatar: string | null;
  empresaNome: string;
  perfilNome: string | null;
  cargo: string;
}

// Painel de aba (oculto via CSS quando inativo, p/ preservar estado dos campos)
function Painel({ ativo, children }: { ativo: boolean; children: React.ReactNode }) {
  return <div className={cn("space-y-8", !ativo && "hidden")}>{children}</div>;
}

// Redimensiona a imagem p/ no máx 256px e exporta JPEG leve (data URL)
function redimensionar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("img"));
      img.onload = () => {
        const max = 256;
        let { width, height } = img;
        if (width > height && width > max) { height = (height * max) / width; width = max; }
        else if (height >= width && height > max) { width = (width * max) / height; height = max; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("ctx"));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

const ABAS = [
  { id: "dados", label: "Dados Pessoais", icone: User },
  { id: "foto", label: "Foto de Perfil", icone: Camera },
  { id: "seguranca", label: "Segurança", icone: Lock },
  { id: "conta", label: "Minha Conta", icone: Building2 },
];

export function PerfilClient({ initial }: { initial: Initial }) {
  const router = useRouter();
  const { update } = useSession();

  const [aba, setAba] = useState("dados");
  const [erro, setErro] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  function mostrarToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000); }
  function trocarAba(id: string) { setAba(id); setErro(""); }

  // ── Foto ──
  const [avatar, setAvatar] = useState<string | null>(initial.avatar);
  const [preview, setPreview] = useState<string | null>(null); // imagem redimensionada pendente
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const fotoRef = useRef<HTMLInputElement>(null);

  async function onFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fotoRef.current) fotoRef.current.value = "";
    if (!file) return;
    setErro("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setErro("Use uma imagem JPG ou PNG."); return; }
    if (file.size > 2 * 1024 * 1024) { setErro("Imagem muito grande. Máximo 2 MB."); return; }
    try { setPreview(await redimensionar(file)); }
    catch { setErro("Não foi possível processar a imagem."); }
  }

  async function salvarFoto() {
    if (!preview) return;
    setErro(""); setEnviandoFoto(true);
    try {
      const res = await fetch("/api/perfil/avatar", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imagem: preview }),
      });
      const data = await res.json();
      if (!res.ok) { setErro(data?.erro ?? "Erro ao enviar foto."); return; }
      setAvatar(data.avatar);
      setPreview(null);
      mostrarToast("Foto atualizada com sucesso!");
      router.refresh(); // reflete no sidebar/header (avatar vem do banco no layout)
    } catch { setErro("Erro de conexão."); }
    finally { setEnviandoFoto(false); }
  }

  // ── Dados pessoais ──
  const [nome, setNome] = useState(initial.nome);
  const [email, setEmail] = useState(initial.email);
  const [confirmacaoEmail, setConfirmacaoEmail] = useState("");
  const [salvandoDados, setSalvandoDados] = useState(false);
  const emailMudou = email.trim().toLowerCase() !== initial.email.toLowerCase();

  async function salvarDados() {
    setErro("");
    if (!nome.trim()) { setErro("Informe o nome completo."); return; }
    if (emailMudou && confirmacaoEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
      setErro("A confirmação de e-mail não coincide."); return;
    }
    setSalvandoDados(true);
    try {
      const res = await fetch("/api/perfil", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nome.trim(), email: email.trim(), confirmacaoEmail: confirmacaoEmail.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setErro(data?.erro ?? "Erro ao salvar."); return; }
      setConfirmacaoEmail("");
      mostrarToast("Dados atualizados com sucesso!");
      await update({ name: data.nome, email: data.email }); // atualiza o JWT (sidebar/header)
      router.refresh();
    } catch { setErro("Erro de conexão."); }
    finally { setSalvandoDados(false); }
  }

  // ── Senha ──
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [salvandoSenha, setSalvandoSenha] = useState(false);

  async function salvarSenha() {
    setErro("");
    if (novaSenha.length < 8) { setErro("A nova senha deve ter no mínimo 8 caracteres."); return; }
    if (novaSenha !== confirmar) { setErro("A confirmação da nova senha não coincide."); return; }
    setSalvandoSenha(true);
    try {
      const res = await fetch("/api/perfil/senha", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senhaAtual, novaSenha, confirmar }),
      });
      const data = await res.json();
      if (!res.ok) { setErro(data?.erro ?? "Erro ao alterar senha."); return; }
      setSenhaAtual(""); setNovaSenha(""); setConfirmar("");
      mostrarToast("Senha alterada com sucesso!");
    } catch { setErro("Erro de conexão."); }
    finally { setSalvandoSenha(false); }
  }

  const iniciais = nome?.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase() || "??";

  // Ação do botão "Salvar" (depende da aba ativa; oculto na aba somente-leitura)
  const acao: { label: string; fn: () => void; saving: boolean; disabled?: boolean } | null =
    aba === "dados" ? { label: "Salvar alterações", fn: salvarDados, saving: salvandoDados }
      : aba === "foto" ? { label: "Salvar foto", fn: salvarFoto, saving: enviandoFoto, disabled: !preview }
      : aba === "seguranca" ? { label: "Alterar senha", fn: salvarSenha, saving: salvandoSenha }
      : null;

  const BotaoSalvar = ({ compact = false }: { compact?: boolean }) =>
    acao ? (
      <Button type="button" variant="success" size={compact ? "sm" : "md"} loading={acao.saving} disabled={acao.disabled} onClick={acao.fn}>
        <FileCheck className="w-4 h-4" /> {acao.label}
      </Button>
    ) : null;

  return (
    <div className="min-h-full -m-6 bg-[#F8FAFC] p-4 sm:p-6">
      {/* Toast de sucesso */}
      {toast && (
        <div className="fixed top-5 right-5 z-50 flex items-center gap-2 bg-success-600 text-white text-sm font-medium rounded-xl px-4 py-3 shadow-card-hover animate-in fade-in slide-in-from-top-2">
          <FileCheck className="w-4 h-4" /> {toast}
        </div>
      )}

      <div className="max-w-5xl mx-auto space-y-5">
        {/* Cabeçalho fixo: título + badges + ação */}
        <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-[#F8FAFC]/90 backdrop-blur border-b border-surface-border">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <h1 className="text-xl font-bold text-ink truncate">{nome || "Meu Perfil"}</h1>
              <span className="inline-flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium rounded-lg px-2.5 py-1">
                <ShieldCheck className="w-3.5 h-3.5" /> {initial.perfilNome ?? initial.cargo}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                <Briefcase className="w-3 h-3" /> {initial.cargo}
              </span>
            </div>
            <BotaoSalvar compact />
          </div>
        </div>

        {/* Card central branco com abas + conteúdo */}
        <div className="bg-white rounded-2xl shadow-card border border-surface-border overflow-hidden">
          <nav className="flex gap-1.5 overflow-x-auto px-4 pt-4 pb-4 border-b border-surface-border">
            {ABAS.map((t) => {
              const ativa = aba === t.id;
              return (
                <button
                  key={t.id} type="button" onClick={() => trocarAba(t.id)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl whitespace-nowrap transition-all",
                    ativa ? "bg-primary-500 text-white shadow-sm" : "text-ink-muted hover:text-ink hover:bg-surface-alt",
                  )}
                >
                  <t.icone className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </nav>

          <div className="p-5 sm:p-6 lg:p-8">
            {erro && (
              <div className="mb-6 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" /> {erro}
              </div>
            )}

            {/* ABA 1 — Dados Pessoais */}
            <Painel ativo={aba === "dados"}>
              <FormSection title="Dados pessoais" icon={<User className="w-3.5 h-3.5" />}>
                <FormGrid>
                  <FormField label="Nome completo" required>
                    <Input value={nome} onChange={(e) => setNome(e.target.value)} />
                  </FormField>
                  <FormField label="E-mail" required>
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </FormField>
                </FormGrid>
                {emailMudou && (
                  <FormGrid>
                    <FormField label="Confirmar e-mail" required hint="Repita o novo e-mail para confirmar a alteração">
                      <Input type="email" value={confirmacaoEmail} onChange={(e) => setConfirmacaoEmail(e.target.value)} />
                    </FormField>
                  </FormGrid>
                )}
              </FormSection>
            </Painel>

            {/* ABA 2 — Foto de Perfil */}
            <Painel ativo={aba === "foto"}>
              <FormSection title="Foto de perfil" icon={<Camera className="w-3.5 h-3.5" />}>
                <div className="flex flex-col items-center gap-4 py-4">
                  {preview || avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={(preview ?? avatar)!} alt="Foto de perfil" className="w-32 h-32 rounded-full object-cover border-4 border-white shadow-card" />
                  ) : (
                    <span className="w-32 h-32 rounded-full bg-gradient-to-br from-primary-500 to-success-500 flex items-center justify-center text-white text-4xl font-bold shadow-card">{iniciais}</span>
                  )}
                  <input ref={fotoRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onFoto} className="hidden" />
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="secondary" onClick={() => fotoRef.current?.click()}>
                      <Camera className="w-4 h-4" /> Alterar foto
                    </Button>
                    {preview && (
                      <Button type="button" variant="ghost" onClick={() => setPreview(null)}>Descartar</Button>
                    )}
                  </div>
                  <p className="text-xs text-ink-muted text-center">
                    JPG ou PNG, máximo 2 MB.{preview && " Pré-visualização — clique em \"Salvar foto\" para confirmar."}
                  </p>
                </div>
              </FormSection>
            </Painel>

            {/* ABA 3 — Segurança */}
            <Painel ativo={aba === "seguranca"}>
              <FormSection title="Alterar senha" icon={<Lock className="w-3.5 h-3.5" />}>
                <FormGrid>
                  <FormField label="Senha atual" required>
                    <Input type="password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} autoComplete="current-password" />
                  </FormField>
                </FormGrid>
                <FormGrid>
                  <FormField label="Nova senha" required hint="Mínimo de 8 caracteres">
                    <Input type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} autoComplete="new-password" />
                  </FormField>
                  <FormField label="Confirmar nova senha" required>
                    <Input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" />
                  </FormField>
                </FormGrid>
              </FormSection>
            </Painel>

            {/* ABA 4 — Minha Conta (somente leitura) */}
            <Painel ativo={aba === "conta"}>
              <FormSection title="Informações da conta" icon={<Building2 className="w-3.5 h-3.5" />}>
                <FormGrid>
                  <FormField label="Empresa">
                    <Input value={initial.empresaNome} disabled readOnly className="bg-gray-100 text-gray-600" />
                  </FormField>
                  <FormField label="Perfil de acesso">
                    <Input value={initial.perfilNome ?? initial.cargo} disabled readOnly className="bg-gray-100 text-gray-600" />
                  </FormField>
                </FormGrid>
                <FormGrid>
                  <FormField label="Cargo / função">
                    <Input value={initial.cargo} disabled readOnly className="bg-gray-100 text-gray-600" />
                  </FormField>
                </FormGrid>
                <p className="text-xs text-ink-muted">Estes dados são definidos por um administrador e não podem ser editados aqui.</p>
              </FormSection>
            </Painel>
          </div>

          {/* Barra de ações no rodapé */}
          {acao && (
            <div className="flex items-center justify-end gap-3 px-5 sm:px-6 lg:px-8 py-4 bg-surface-alt/40 border-t border-surface-border">
              <BotaoSalvar />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
