"use client";

import { useRef, useState } from "react";
import { AlertCircle, Check, FileUp, Loader2, Mail, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { InputData } from "@/components/ui/input-data";
import { cn, formatarTelefone } from "@/lib/utils";
import { digitos, formatarDocumento } from "@/lib/documento";
import { buscarCep, cepCompleto, formatarCep } from "@/lib/cep";
import {
  CODIGO_TAMANHO, ESCOLARIDADES, ESTADOS_CIVIS, PARENTESCOS, TIPOS_CONTA, UFS, formatarPis,
  type DocumentoPedido, type FormAdmissao,
} from "@/lib/admissao/admissao";

/** O que cada bloco de campos recebe: o formulário e como mudar um campo. */
export interface CamposProps {
  form: FormAdmissao;
  set: <K extends keyof FormAdmissao>(campo: K, valor: FormAdmissao[K]) => void;
}


/* ───────── etapa 1: os dados da pessoa ───────── */

export function CamposDados({ form, set }: CamposProps) {
  return (
    <div className="space-y-4" data-etapa-campos="DADOS">
      <FormField label="Nome completo" required>
        <Input value={form.nome} onChange={(e) => set("nome", e.target.value)} caixa="nome" data-campo="nome" autoComplete="name" />
      </FormField>
      <FormGrid>
        <FormField label="CPF" required dica="Digite o seu CPF: ele é conferido com o do convite que o RH abriu.">
          <Input value={formatarDocumento(form.cpf)} onChange={(e) => set("cpf", digitos(e.target.value).slice(0, 11))}
            inputMode="numeric" data-campo="cpf" placeholder="000.000.000-00" />
        </FormField>
        <FormField label="Data de nascimento" required>
          <InputData value={form.dataNascimento} onChange={(v) => set("dataNascimento", v)} aria-label="Data de nascimento" />
        </FormField>
      </FormGrid>
      <FormGrid>
        <FormField label="RG" required>
          <Input value={form.rg} onChange={(e) => set("rg", e.target.value)} data-campo="rg" />
        </FormField>
        <FormField label="PIS / NIS" hint="Se não souber, deixe em branco."
          dica="O número do PIS/PASEP/NIS aparece na carteira de trabalho digital e no extrato do FGTS.">
          <Input value={formatarPis(form.pis)} onChange={(e) => set("pis", digitos(e.target.value).slice(0, 11))}
            inputMode="numeric" data-campo="pis" placeholder="000.00000.00-0" />
        </FormField>
      </FormGrid>
      <FormGrid>
        <FormField label="Nome da mãe" required>
          <Input value={form.nomeMae} onChange={(e) => set("nomeMae", e.target.value)} caixa="nome" data-campo="nomeMae" />
        </FormField>
        <FormField label="Nome do pai">
          <Input value={form.nomePai} onChange={(e) => set("nomePai", e.target.value)} caixa="nome" data-campo="nomePai" />
        </FormField>
      </FormGrid>
      <FormGrid cols={3}>
        <FormField label="Estado civil">
          <Select value={form.estadoCivil} onChange={(e) => set("estadoCivil", e.target.value)} data-campo="estadoCivil">
            <option value="">Selecione</option>
            {ESTADOS_CIVIS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </Select>
        </FormField>
        <FormField label="Escolaridade">
          <Select value={form.escolaridade} onChange={(e) => set("escolaridade", e.target.value)} data-campo="escolaridade">
            <option value="">Selecione</option>
            {ESCOLARIDADES.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </Select>
        </FormField>
        <FormField label="Sexo">
          <Select value={form.sexo} onChange={(e) => set("sexo", e.target.value)} data-campo="sexo">
            <option value="">Selecione</option>
            <option value="M">Masculino</option>
            <option value="F">Feminino</option>
            <option value="OUTRO">Outro</option>
          </Select>
        </FormField>
      </FormGrid>
      <FormGrid>
        <FormField label="Nacionalidade">
          <Input value={form.nacionalidade} onChange={(e) => set("nacionalidade", e.target.value)} data-campo="nacionalidade" />
        </FormField>
        <FormField label="Naturalidade" hint="Cidade onde nasceu.">
          <Input value={form.naturalidade} onChange={(e) => set("naturalidade", e.target.value)} caixa="cidade" data-campo="naturalidade" />
        </FormField>
      </FormGrid>
      <FormGrid cols={3}>
        <FormField label="Carteira de trabalho (número)">
          <Input value={form.ctpsNumero} onChange={(e) => set("ctpsNumero", e.target.value)} inputMode="numeric" data-campo="ctpsNumero" />
        </FormField>
        <FormField label="Série">
          <Input value={form.ctpsSerie} onChange={(e) => set("ctpsSerie", e.target.value)} inputMode="numeric" data-campo="ctpsSerie" />
        </FormField>
        <FormField label="UF da carteira">
          <Select value={form.ctpsUf} onChange={(e) => set("ctpsUf", e.target.value)} data-campo="ctpsUf">
            <option value="">—</option>
            {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
        </FormField>
      </FormGrid>
      <FormGrid>
        <FormField label="Título de eleitor">
          <Input value={form.tituloEleitor} onChange={(e) => set("tituloEleitor", e.target.value)} inputMode="numeric" data-campo="tituloEleitor" />
        </FormField>
        <FormField label="Certificado de reservista" hint="Só para quem tem.">
          <Input value={form.reservista} onChange={(e) => set("reservista", e.target.value)} data-campo="reservista" />
        </FormField>
      </FormGrid>
      <FormField label="Celular (WhatsApp)" required hint="Com DDD." dica="Canal da empresa com o colaborador: WhatsApp, avisos e o app de campo.">
        <Input value={formatarTelefone(form.telefone)} onChange={(e) => set("telefone", digitos(e.target.value).slice(0, 11))} inputMode="tel" data-campo="telefone" autoComplete="tel" placeholder="(00) 90000-0000" />
      </FormField>
    </div>
  );
}

/* ───────── verificação do e-mail ───────── */

export function VerificarEmail({ form, set, token, verificado, onVerificado }: CamposProps & {
  token: string;
  /** O e-mail já verificado (null = nenhum) */
  verificado: string | null;
  onVerificado: (email: string) => void;
}) {
  const [pedindo, setPedindo] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const [pedido, setPedido] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const email = form.email.trim();
  const confere = !!verificado && verificado.toLowerCase() === email.toLowerCase();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  async function pedir() {
    setErro(""); setAviso(""); setPedindo(true);
    try {
      const res = await fetch(`/api/publico/admissao/${token}/codigo`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d?.erro ?? "Não foi possível enviar o código."); return; }
      if (!d.enviado) { setAviso(d.erro ?? "O envio de e-mail não está configurado. Siga sem verificar."); return; }
      setPedido(true);
      setAviso(`Código enviado para ${d.para}. Vale por alguns minutos.`);
    } catch { setErro("Erro de conexão. Tente de novo."); } finally { setPedindo(false); }
  }

  async function conferir() {
    setErro(""); setConferindo(true);
    try {
      const res = await fetch(`/api/publico/admissao/${token}/codigo/conferir`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, codigo }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d?.erro ?? "Código incorreto."); return; }
      onVerificado(d.email);
      setPedido(false); setCodigo(""); setAviso("");
    } catch { setErro("Erro de conexão. Tente de novo."); } finally { setConferindo(false); }
  }

  return (
    <div className="space-y-3" data-verificar-email={confere ? "ok" : "pendente"}>
      <FormField label="E-mail" required hint="Para receber o contrato e os avisos da empresa.">
        <Input type="email" value={form.email} onChange={(e) => { set("email", e.target.value); setPedido(false); }}
          caixa="email" data-campo="email" autoComplete="email" inputMode="email" />
      </FormField>

      {confere ? (
        <p className="flex items-center gap-1.5 text-sm text-ok-texto" data-email-verificado>
          <Check className="w-4 h-4 shrink-0" aria-hidden /> E-mail confirmado.
        </p>
      ) : emailOk ? (
        <div className="space-y-3">
          {!pedido ? (
            <Button type="button" variant="secondary" onClick={pedir} loading={pedindo} data-pedir-codigo className="w-full sm:w-auto justify-center">
              <Mail className="w-4 h-4" /> Enviar código de confirmação
            </Button>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
              <FormField label={`Código de ${CODIGO_TAMANHO} números`} className="flex-1">
                <Input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, CODIGO_TAMANHO))}
                  inputMode="numeric" autoComplete="one-time-code" data-campo="codigo" placeholder="000000"
                  className="tracking-[0.4em] text-center text-lg" />
              </FormField>
              <div className="flex gap-2">
                <Button type="button" onClick={conferir} loading={conferindo} disabled={codigo.length !== CODIGO_TAMANHO} data-conferir-codigo>
                  Confirmar
                </Button>
                <Button type="button" variant="ghost" onClick={pedir} loading={pedindo} data-reenviar-codigo>Reenviar</Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {aviso && !erro && <p className="text-xs text-ink-muted" data-email-aviso>{aviso}</p>}
      {erro && (
        <p className="flex items-start gap-1.5 text-xs text-atrasado-texto" data-email-erro>
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden /> {erro}
        </p>
      )}
    </div>
  );
}

/* ───────── etapa 2: endereço (com CEP) ───────── */

export function CamposEndereco({ form, set }: CamposProps) {
  const [buscando, setBuscando] = useState(false);
  const [achou, setAchou] = useState<boolean | null>(null);

  async function completar(cep: string) {
    if (!cepCompleto(cep)) return;
    setBuscando(true);
    const e = await buscarCep(cep);
    setBuscando(false);
    setAchou(!!e);
    if (!e) return;
    if (e.logradouro) set("endereco", e.logradouro);
    if (e.bairro) set("bairro", e.bairro);
    if (e.cidade) set("cidade", e.cidade);
    if (e.estado) set("estado", e.estado);
  }

  return (
    <div className="space-y-4" data-etapa-campos="ENDERECO">
      <FormGrid>
        <FormField label="CEP" required hint={buscando ? "Buscando o endereço…" : achou === false ? "CEP não encontrado: preencha à mão." : "O endereço é preenchido pelo CEP."}>
          <div className="relative">
            <Input value={formatarCep(form.cep)} onChange={(e) => { const v = formatarCep(e.target.value); set("cep", v); setAchou(null); if (cepCompleto(v)) completar(v); }}
              inputMode="numeric" data-campo="cep" placeholder="00000-000" autoComplete="postal-code" />
            {buscando && <Loader2 className="w-4 h-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />}
          </div>
        </FormField>
        <FormField label="Número" required>
          <Input value={form.numero} onChange={(e) => set("numero", e.target.value)} data-campo="numero" />
        </FormField>
      </FormGrid>
      <FormField label="Endereço" required>
        <Input value={form.endereco} onChange={(e) => set("endereco", e.target.value)} caixa="endereco" data-campo="endereco" autoComplete="street-address" />
      </FormField>
      <FormGrid>
        <FormField label="Complemento">
          <Input value={form.complemento} onChange={(e) => set("complemento", e.target.value)} data-campo="complemento" placeholder="Apto, bloco, fundos" />
        </FormField>
        <FormField label="Bairro" required>
          <Input value={form.bairro} onChange={(e) => set("bairro", e.target.value)} data-campo="bairro" />
        </FormField>
      </FormGrid>
      <FormGrid>
        <FormField label="Cidade" required>
          <Input value={form.cidade} onChange={(e) => set("cidade", e.target.value)} caixa="cidade" data-campo="cidade" />
        </FormField>
        <FormField label="Estado" required>
          <Select value={form.estado} onChange={(e) => set("estado", e.target.value)} data-campo="estado">
            <option value="">—</option>
            {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
        </FormField>
      </FormGrid>
    </div>
  );
}

/* ───────── etapa 4: conta para o salário ───────── */

export function CamposBanco({ form, set }: CamposProps) {
  return (
    <div className="space-y-4" data-etapa-campos="BANCO">
      <p className="text-sm text-ink-muted">Conta no seu nome, ou só a chave PIX.</p>
      <FormGrid>
        <FormField label="Banco">
          <Input value={form.banco} onChange={(e) => set("banco", e.target.value)} data-campo="banco" placeholder="Nome ou número" />
        </FormField>
        <FormField label="Tipo de conta">
          <Select value={form.contaTipo} onChange={(e) => set("contaTipo", e.target.value)} data-campo="contaTipo">
            {TIPOS_CONTA.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </Select>
        </FormField>
      </FormGrid>
      <FormGrid>
        <FormField label="Agência">
          <Input value={form.agencia} onChange={(e) => set("agencia", e.target.value)} data-campo="agencia" />
        </FormField>
        <FormField label="Conta (com dígito)">
          <Input value={form.conta} onChange={(e) => set("conta", e.target.value)} data-campo="conta" />
        </FormField>
      </FormGrid>
      <FormField label="Chave PIX" hint="No lugar de agência e conta, se preferir.">
        <Input value={form.pixChave} onChange={(e) => set("pixChave", e.target.value)} data-campo="pixChave" placeholder="CPF, telefone, e-mail ou chave aleatória" />
      </FormField>
    </div>
  );
}

/* ───────── etapa 5: dependentes ───────── */

export function CamposDependentes({ form, set }: CamposProps) {
  const add = () => set("dependentes", [...form.dependentes, { nome: "", nascimento: "", cpf: "", parentesco: "FILHO", irrf: false, salarioFamilia: false }]);
  const tirar = (i: number) => set("dependentes", form.dependentes.filter((_, x) => x !== i));
  const mudar = (i: number, campo: string, valor: unknown) =>
    set("dependentes", form.dependentes.map((d, x) => (x === i ? { ...d, [campo]: valor } : d)));

  return (
    <div className="space-y-4" data-etapa-campos="DEPENDENTES">
      <p className="text-sm text-ink-muted">Filhos e cônjuge, para imposto de renda e salário-família. Sem dependentes, siga.</p>

      {form.dependentes.map((d, i) => (
        <div key={i} className="rounded-card border border-surface-border p-3 space-y-3" data-dependente={i}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-ink">Dependente {i + 1}</p>
            <button type="button" onClick={() => tirar(i)} aria-label={`Tirar o dependente ${i + 1}`}
              className="p-1.5 rounded text-ink-muted hover:text-atrasado" data-tirar-dependente={i}>
              <Trash2 className="w-4 h-4" aria-hidden />
            </button>
          </div>
          <FormField label="Nome completo" required>
            <Input value={d.nome} onChange={(e) => mudar(i, "nome", e.target.value)} caixa="nome" data-dep-nome={i} />
          </FormField>
          <FormGrid>
            <FormField label="Data de nascimento">
              <InputData value={d.nascimento} onChange={(v) => mudar(i, "nascimento", v)} aria-label={`Nascimento do dependente ${i + 1}`} />
            </FormField>
            <FormField label="CPF">
              <Input value={formatarDocumento(d.cpf)} onChange={(e) => mudar(i, "cpf", digitos(e.target.value).slice(0, 11))} inputMode="numeric" data-dep-cpf={i} />
            </FormField>
          </FormGrid>
          <FormField label="Parentesco">
            <Select value={d.parentesco} onChange={(e) => mudar(i, "parentesco", e.target.value)} data-dep-parentesco={i}>
              {PARENTESCOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </Select>
          </FormField>
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={d.irrf} onChange={(e) => mudar(i, "irrf", e.target.checked)} className="accent-primary-600 w-4 h-4" data-dep-irrf={i} />
              Imposto de renda
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={d.salarioFamilia} onChange={(e) => mudar(i, "salarioFamilia", e.target.checked)} className="accent-primary-600 w-4 h-4" data-dep-salario={i} />
              Salário-família
            </label>
          </div>
        </div>
      ))}

      <Button type="button" variant="secondary" onClick={add} className="w-full justify-center border-dashed" data-add-dependente>
        <Plus className="w-4 h-4" /> Adicionar dependente
      </Button>
    </div>
  );
}

/* ───────── etapa 3: documentos ───────── */

const TAMANHO_MAX = 8 * 1024 * 1024;

export function CamposDocumentos({ token, pedidos, enviados, onMudou }: {
  token: string;
  pedidos: DocumentoPedido[];
  enviados: { id: string; docId: string; nome: string }[];
  onMudou: () => void;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  async function enviar(doc: DocumentoPedido, file: File | undefined) {
    if (!file) return;
    setErro("");
    if (file.size > TAMANHO_MAX) { setErro(`"${file.name}" passa de 8 MB. Tire outra foto ou reduza o arquivo.`); return; }
    setOcupado(doc.id);
    try {
      const arquivoUrl = await new Promise<string>((ok, falhou) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result));
        r.onerror = () => falhou(new Error("leitura"));
        r.readAsDataURL(file);
      });
      const res = await fetch(`/api/publico/admissao/${token}/documentos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: doc.id, nome: file.name, arquivoUrl }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d?.erro ?? "Não foi possível enviar o arquivo."); return; }
      onMudou();
    } catch { setErro("Não foi possível ler o arquivo. Tente de novo."); } finally { setOcupado(null); }
  }

  async function apagar(id: string) {
    setErro(""); setOcupado(id);
    try {
      const res = await fetch(`/api/publico/admissao/${token}/documentos/${id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErro(d?.erro ?? "Não foi possível apagar."); return; }
      onMudou();
    } catch { setErro("Erro de conexão. Tente de novo."); } finally { setOcupado(null); }
  }

  return (
    <div className="space-y-3" data-etapa-campos="DOCUMENTOS">
      <p className="text-sm text-ink-muted">Foto do documento ou PDF. Dá para mandar mais de um arquivo no mesmo item.</p>
      {pedidos.map((doc) => {
        const meus = enviados.filter((e) => e.docId === doc.id);
        return (
          <DocumentoItem
            key={doc.id} doc={doc} enviados={meus} ocupado={ocupado === doc.id}
            onArquivo={(f) => enviar(doc, f)} onApagar={apagar} apagando={ocupado}
          />
        );
      })}
      {erro && (
        <p className="flex items-start gap-1.5 text-xs text-atrasado-texto" data-documentos-erro>
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden /> {erro}
        </p>
      )}
    </div>
  );
}

function DocumentoItem({ doc, enviados, ocupado, onArquivo, onApagar, apagando }: {
  doc: DocumentoPedido;
  enviados: { id: string; docId: string; nome: string }[];
  ocupado: boolean;
  onArquivo: (f: File | undefined) => void;
  onApagar: (id: string) => void;
  apagando: string | null;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const pegar = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ""; onArquivo(f); };
  const completo = enviados.length > 0;

  return (
    <div className={cn("rounded-card border p-3 space-y-2", completo ? "border-ok/30 bg-ok-claro/30" : doc.obrigatorio ? "border-dashed border-primary-300" : "border-surface-border")}
      data-documento={doc.id} data-enviado={completo ? "" : undefined}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink">
          {doc.rotulo}{doc.obrigatorio && <span className="text-atrasado"> *</span>}
        </p>
        {completo && <Check className="w-4 h-4 text-ok-texto shrink-0" aria-hidden />}
      </div>

      {enviados.length > 0 && (
        <ul className="space-y-1">
          {enviados.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 text-xs text-ink-muted bg-white border border-surface-border rounded px-2 py-1.5">
              <span className="truncate">{e.nome}</span>
              <button type="button" onClick={() => onApagar(e.id)} aria-label={`Apagar ${e.nome}`} data-apagar-doc={e.id}
                className="p-1 rounded text-ink-muted hover:text-atrasado shrink-0">
                {apagando === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Trash2 className="w-3.5 h-3.5" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={pegar} aria-label={`${doc.rotulo} (câmera)`} />
      <input ref={arquivo} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={pegar} aria-label={`${doc.rotulo} (arquivo)`} />
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => camera.current?.click()} loading={ocupado} className="flex-1 justify-center" data-foto-doc={doc.id}>
          Fotografar
        </Button>
        <Button type="button" variant="ghost" onClick={() => arquivo.current?.click()} loading={ocupado} className="flex-1 justify-center" data-arquivo-doc={doc.id}>
          <FileUp className="w-4 h-4" /> Escolher arquivo
        </Button>
      </div>
    </div>
  );
}
