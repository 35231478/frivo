"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { cn } from "@/lib/utils";
import { Camera, Check, AlertCircle, User, Lock, Building2 } from "lucide-react";

interface Initial {
  nome: string;
  email: string;
  avatar: string | null;
  empresaNome: string;
  perfilNome: string | null;
  cargo: string;
}

type Msg = { tipo: "ok" | "erro"; texto: string } | null;

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

function Feedback({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <div className={cn("flex items-center gap-2 text-sm rounded-lg px-3 py-2 border",
      msg.tipo === "ok" ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700")}>
      {msg.tipo === "ok" ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />} {msg.texto}
    </div>
  );
}

const cardCls = "bg-white rounded-xl border border-gray-200 p-5 sm:p-6 space-y-4";
const tituloCls = "flex items-center gap-2 text-base font-semibold text-gray-900";

export function PerfilClient({ initial }: { initial: Initial }) {
  const router = useRouter();
  const { update } = useSession();

  const iniciais = initial.nome?.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase() || "??";

  // ── Foto ──
  const [avatar, setAvatar] = useState<string | null>(initial.avatar);
  const [msgFoto, setMsgFoto] = useState<Msg>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const fotoRef = useRef<HTMLInputElement>(null);

  async function onFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fotoRef.current) fotoRef.current.value = "";
    if (!file) return;
    setMsgFoto(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setMsgFoto({ tipo: "erro", texto: "Use uma imagem JPG ou PNG." }); return; }
    if (file.size > 2 * 1024 * 1024) { setMsgFoto({ tipo: "erro", texto: "Imagem muito grande. Máximo 2 MB." }); return; }
    setEnviandoFoto(true);
    try {
      const imagem = await redimensionar(file);
      const res = await fetch("/api/perfil/avatar", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imagem }),
      });
      const data = await res.json();
      if (!res.ok) { setMsgFoto({ tipo: "erro", texto: data?.erro ?? "Erro ao enviar foto." }); return; }
      setAvatar(data.avatar);
      setMsgFoto({ tipo: "ok", texto: "Foto atualizada." });
      router.refresh(); // reflete no sidebar/header (avatar vem do banco no layout)
    } catch { setMsgFoto({ tipo: "erro", texto: "Não foi possível processar a imagem." }); }
    finally { setEnviandoFoto(false); }
  }

  // ── Dados pessoais ──
  const [nome, setNome] = useState(initial.nome);
  const [email, setEmail] = useState(initial.email);
  const [confirmacaoEmail, setConfirmacaoEmail] = useState("");
  const [msgDados, setMsgDados] = useState<Msg>(null);
  const [salvandoDados, setSalvandoDados] = useState(false);
  const emailMudou = email.trim().toLowerCase() !== initial.email.toLowerCase();

  async function salvarDados() {
    setMsgDados(null);
    if (!nome.trim()) { setMsgDados({ tipo: "erro", texto: "Informe o nome completo." }); return; }
    if (emailMudou && confirmacaoEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
      setMsgDados({ tipo: "erro", texto: "A confirmação de e-mail não coincide." }); return;
    }
    setSalvandoDados(true);
    try {
      const res = await fetch("/api/perfil", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nome.trim(), email: email.trim(), confirmacaoEmail: confirmacaoEmail.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setMsgDados({ tipo: "erro", texto: data?.erro ?? "Erro ao salvar." }); return; }
      setConfirmacaoEmail("");
      setMsgDados({ tipo: "ok", texto: "Dados atualizados." });
      await update({ name: data.nome, email: data.email }); // atualiza o JWT (sidebar/header)
      router.refresh();
    } catch { setMsgDados({ tipo: "erro", texto: "Erro de conexão." }); }
    finally { setSalvandoDados(false); }
  }

  // ── Senha ──
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [msgSenha, setMsgSenha] = useState<Msg>(null);
  const [salvandoSenha, setSalvandoSenha] = useState(false);

  async function salvarSenha() {
    setMsgSenha(null);
    if (novaSenha.length < 8) { setMsgSenha({ tipo: "erro", texto: "A nova senha deve ter no mínimo 8 caracteres." }); return; }
    if (novaSenha !== confirmar) { setMsgSenha({ tipo: "erro", texto: "A confirmação da nova senha não coincide." }); return; }
    setSalvandoSenha(true);
    try {
      const res = await fetch("/api/perfil/senha", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senhaAtual, novaSenha, confirmar }),
      });
      const data = await res.json();
      if (!res.ok) { setMsgSenha({ tipo: "erro", texto: data?.erro ?? "Erro ao alterar senha." }); return; }
      setSenhaAtual(""); setNovaSenha(""); setConfirmar("");
      setMsgSenha({ tipo: "ok", texto: "Senha alterada com sucesso." });
    } catch { setMsgSenha({ tipo: "erro", texto: "Erro de conexão." }); }
    finally { setSalvandoSenha(false); }
  }

  const infoConta = [
    { label: "Empresa", valor: initial.empresaNome },
    { label: "Perfil de acesso", valor: initial.perfilNome ?? initial.cargo },
    { label: "Função", valor: initial.cargo },
  ].filter((i) => i.valor);

  return (
    <div className="space-y-5">
      {/* 1. Foto de perfil */}
      <div className={cardCls}>
        <h3 className={tituloCls}><Camera className="w-4 h-4 text-primary-500" /> Foto de perfil</h3>
        <div className="flex items-center gap-5">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="Foto de perfil" className="w-20 h-20 rounded-full object-cover border border-gray-200" />
          ) : (
            <span className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-500 to-success-500 flex items-center justify-center text-white text-2xl font-bold">{iniciais}</span>
          )}
          <div className="space-y-2">
            <input ref={fotoRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onFoto} className="hidden" />
            <Button type="button" variant="secondary" loading={enviandoFoto} onClick={() => fotoRef.current?.click()}>
              <Camera className="w-4 h-4" /> Alterar foto
            </Button>
            <p className="text-[11px] text-gray-400">JPG ou PNG, máximo 2 MB.</p>
          </div>
        </div>
        <Feedback msg={msgFoto} />
      </div>

      {/* 2. Dados pessoais */}
      <div className={cardCls}>
        <h3 className={tituloCls}><User className="w-4 h-4 text-primary-500" /> Dados pessoais</h3>
        <FormField label="Nome completo" required>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} />
        </FormField>
        <FormField label="E-mail" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        {emailMudou && (
          <FormField label="Confirmação de e-mail" required hint="Repita o novo e-mail para confirmar">
            <Input type="email" value={confirmacaoEmail} onChange={(e) => setConfirmacaoEmail(e.target.value)} />
          </FormField>
        )}
        <Feedback msg={msgDados} />
        <div className="flex justify-end">
          <Button type="button" loading={salvandoDados} onClick={salvarDados}><Check className="w-4 h-4" /> Salvar alterações</Button>
        </div>
      </div>

      {/* 3. Segurança — senha */}
      <div className={cardCls}>
        <h3 className={tituloCls}><Lock className="w-4 h-4 text-primary-500" /> Alterar senha</h3>
        <FormField label="Senha atual" required>
          <Input type="password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} autoComplete="current-password" />
        </FormField>
        <FormField label="Nova senha" required hint="Mínimo de 8 caracteres">
          <Input type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} autoComplete="new-password" />
        </FormField>
        <FormField label="Confirmar nova senha" required>
          <Input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" />
        </FormField>
        <Feedback msg={msgSenha} />
        <div className="flex justify-end">
          <Button type="button" loading={salvandoSenha} onClick={salvarSenha}><Lock className="w-4 h-4" /> Alterar senha</Button>
        </div>
      </div>

      {/* 4. Informações da conta (somente leitura) */}
      <div className={cardCls}>
        <h3 className={tituloCls}><Building2 className="w-4 h-4 text-primary-500" /> Informações da conta</h3>
        <dl className="divide-y divide-gray-50 -my-1">
          {infoConta.map((i) => (
            <div key={i.label} className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-sm text-gray-500">{i.label}</dt>
              <dd className="text-sm font-medium text-gray-900 text-right">{i.valor}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[11px] text-gray-400">Estes dados são definidos por um administrador e não podem ser editados aqui.</p>
      </div>
    </div>
  );
}
