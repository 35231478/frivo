"use client";

import { toast } from "@/components/ui/avisos";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { VARIAVEIS_DISPONIVEIS, TEMPLATES_PADRAO, substituirVariaveis, montarEmailHtml } from "@/lib/email-templates";
import { Pencil, ArrowLeft, Check, Eye, Plus } from "lucide-react";
import { Dica } from "@/components/ui/dica";
import { SomenteLeitura, erroDaResposta, usePodeGerenciarConfig } from "@/components/config/permissao-config";

const SAMPLE: Record<string, string> = {
  cliente_nome: "João Silva", cliente_cnpj: "12.345.678/0001-90", valor: "R$ 1.250,00", vencimento: "10/07/2026",
  dias_para_vencer: "3", dias_em_atraso: "5", descricao: "Manutenção preventiva", numero_os: "OS-9267",
  numero_orcamento: "ORC-3358", numero_contrato: "CT-18", link_boleto: "#", link_documento: "#", link_orcamento: "#",
  empresa_nome: "Sua Empresa", empresa_telefone: "(11) 99999-0000", empresa_email: "contato@empresa.com.br",
  empresa_site: "www.empresa.com.br", mes_referencia: "Junho/2026", data_aprovacao: "01/07/2026",
  usuario_nome: "Maria Souza", link_definir_senha: "#", validade_convite: "72 horas", validade_link: "60 minutos",
};
const EMPRESA_SAMPLE = { nome: "Sua Empresa", telefone: "(11) 99999-0000", email: "contato@empresa.com.br", site: "www.empresa.com.br", endereco: "Av. Exemplo, 100", cidade: "São Paulo", estado: "SP", logo: null };

const AJUDA = "Assunto e corpo de cada e-mail automático. Sem modelo próprio, o sistema usa o texto padrão. Modelo inativo: aquele e-mail não é enviado.";

/**
 * Configurações › Modelos de e-mail: lista dos modelos e o editor com a prévia. Só quem tem
 * Configurações › gerenciar edita ou carrega os modelos padrão (o servidor recusa de qualquer jeito);
 * sem ela, abre para leitura — dá para ver o modelo e a prévia, sem Salvar.
 */
export function EmailTemplatesClient() {
  const podeEditar = usePodeGerenciarConfig();
  const [templates, setTemplates] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState<any | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [assunto, setAssunto] = useState("");
  const [corpo, setCorpo] = useState("");
  const [ativo, setAtivo] = useState(true);

  useEffect(() => { carregar(); }, []);
  function carregar() {
    fetch("/api/email/templates").then((r) => r.json()).then((d) => setTemplates(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setCarregando(false));
  }

  /** Cria os modelos padrão que ainda não existem (os já editados ficam como estão) */
  async function carregarPadroes() {
    setCarregando(true);
    try {
      const res = await fetch("/api/email/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurarPadroes: true }) });
      if (!res.ok) { toast(await erroDaResposta(res, "Não foi possível carregar os modelos padrão."), "erro"); return; }
      const d = await res.json();
      const lista = Array.isArray(d) ? d : [];
      const novos = lista.length - templates.length;
      setTemplates(lista);
      toast(novos > 0 ? `${novos} ${novos === 1 ? "modelo padrão adicionado" : "modelos padrão adicionados"}.` : "Nenhum modelo padrão faltando.");
    } catch { toast("Sem conexão. Tente de novo.", "erro"); } finally { setCarregando(false); }
  }

  function abrir(t: any) { setEditando(t); setAssunto(t.assunto); setCorpo(t.corpo); setAtivo(t.ativo); }
  function inserirVar(v: string) { setCorpo((c) => c + ` {{${v}}}`); }

  async function salvar() {
    setSalvando(true);
    try {
      const res = await fetch(`/api/email/templates/${editando.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assunto, corpo, ativo }) });
      if (res.ok) {
        const t = await res.json();
        setTemplates((p) => p.map((x) => (x.id === t.id ? t : x)));
        setEditando(null);
        toast("Modelo de e-mail salvo.");
      } else {
        // Gravação nunca falha em silêncio (UX-3)
        toast(await erroDaResposta(res, "Não foi possível salvar o modelo."), "erro");
      }
    } catch { toast("Sem conexão. Tente de novo.", "erro"); } finally { setSalvando(false); }
  }

  const def = editando ? TEMPLATES_PADRAO.find((t) => t.tipo === editando.tipo) : undefined;
  const previewHtml = editando ? montarEmailHtml({
    empresa: EMPRESA_SAMPLE, corpoHtml: substituirVariaveis(corpo, SAMPLE),
    botaoLabel: def?.botaoVar ? def.botaoLabel : undefined, botaoUrl: def?.botaoVar ? SAMPLE[def.botaoVar] : undefined,
  }) : "";

  if (carregando) return <p className="text-sm text-ink-subtle text-center py-8">Carregando…</p>;

  if (editando) {
    return (
      <div className="space-y-4" data-editor-modelo>
        <button type="button" onClick={() => setEditando(null)} className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="w-4 h-4" aria-hidden /> Voltar</button>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-4">
            <h3 className="font-bold text-ink">{editando.nome}</h3>
            {!podeEditar && <SomenteLeitura />}
            <fieldset disabled={!podeEditar} className="space-y-4 min-w-0">
            <ToggleSwitch checked={ativo} onChange={setAtivo} label="Modelo ativo" dica="Inativo, este e-mail não é enviado." />
            <FormField label="Assunto"><Input value={assunto} onChange={(e) => setAssunto(e.target.value)} /></FormField>
            <FormField label="Corpo (HTML)"><Textarea value={corpo} onChange={(e) => setCorpo(e.target.value)} rows={10} className="font-mono text-xs" /></FormField>
            <div>
              <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1.5 flex items-center gap-1">Variáveis disponíveis
                <Dica texto="Clique para inserir no fim do corpo. No envio, cada variável vira o dado do cliente ou do documento." rotulo="Variáveis disponíveis" />
              </p>
              <div className="flex flex-wrap gap-1.5">
                {VARIAVEIS_DISPONIVEIS.map((v) => (
                  <button key={v} type="button" onClick={() => inserirVar(v)} className="text-[11px] font-mono bg-surface-alt hover:bg-surface-border text-ink-muted px-2 py-0.5 rounded transition-colors">{`{{${v}}}`}</button>
                ))}
              </div>
            </div>
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditando(null)}>{podeEditar ? "Cancelar" : "Fechar"}</Button>
              {podeEditar && <Button loading={salvando} onClick={salvar} data-salvar-modelo-email><Check className="w-4 h-4" aria-hidden /> Salvar</Button>}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1.5">Prévia</p>
            <iframe title="Prévia do e-mail" srcDoc={previewHtml} className="w-full h-[520px] rounded-lg border border-surface-border bg-white" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-modelos-email>
      {templates.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-surface-border rounded-xl space-y-3" data-sem-modelos>
          <p className="text-sm text-ink-muted">Nenhum modelo próprio: os e-mails saem com o texto padrão.</p>
          {podeEditar ? <Button onClick={carregarPadroes} data-carregar-padroes><Plus className="w-4 h-4" aria-hidden /> Carregar modelos padrão</Button> : <SomenteLeitura className="justify-center" />}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-ink-muted flex items-center gap-1" data-total-modelos-email>{templates.length} {templates.length === 1 ? "modelo" : "modelos"} <Dica texto={AJUDA} rotulo="Modelos de e-mail" /></p>
            {podeEditar && templates.length < TEMPLATES_PADRAO.length && (
              <Button variant="secondary" onClick={carregarPadroes} data-carregar-padroes><Plus className="w-4 h-4" aria-hidden /> Carregar modelos que faltam</Button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {templates.map((t) => (
              <button key={t.id} type="button" onClick={() => abrir(t)} data-modelo-email={t.id} className="text-left border border-surface-border rounded-lg p-4 hover:border-primary-300 hover:shadow-card transition-all">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-ink truncate">{t.nome}</p>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${t.ativo ? "bg-success-50 text-success-700" : "bg-surface-alt text-ink-muted"}`}>{t.ativo ? "Ativo" : "Inativo"}</span>
                </div>
                <p className="text-xs text-ink-muted mt-1 truncate">{t.assunto}</p>
                <span className="inline-flex items-center gap-1 text-xs text-primary-600 mt-2">{podeEditar ? <><Pencil className="w-3 h-3" aria-hidden /> Editar</> : <><Eye className="w-3 h-3" aria-hidden /> Ver</>}</span>
              </button>
            ))}
          </div>
          {!podeEditar && <SomenteLeitura />}
        </>
      )}
    </div>
  );
}
