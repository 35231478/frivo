"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Drawer } from "@/components/ui/drawer";
import { VARIAVEIS_TERMO } from "@/lib/utils";
import { salvarCadastro, type EditorCadastroProps } from "@/components/cadastros/cadastro-padrao";

/** Editor de termo de referência (CadastroPadrao › termos-referencia): nome, descrição e o texto com variáveis. */
export function EditorTermo({ item, aberto, onFechar, onSalvo }: EditorCadastroProps) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!aberto) return;
    setErro("");
    setNome(item?.nome ?? ""); setDescricao((item?.descricao as string | null) ?? ""); setConteudo((item?.conteudo as string | null) ?? "");
  }, [aberto, item]);

  function inserirVariavel(v: string) {
    const ta = textareaRef.current;
    if (!ta) { setConteudo((c) => `${c}${c && !c.endsWith(" ") ? " " : ""}${v}`); return; }
    const start = ta.selectionStart ?? conteudo.length;
    const end = ta.selectionEnd ?? conteudo.length;
    setConteudo(conteudo.slice(0, start) + v + conteudo.slice(end));
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + v.length; });
  }

  async function salvar() {
    if (!nome.trim()) { setErro("Nome é obrigatório."); return; }
    setSalvando(true); setErro("");
    const r = await salvarCadastro("termos-referencia", item?.id ?? null, { nome: nome.trim(), descricao: descricao.trim() || null, conteudo });
    setSalvando(false);
    if (!r.ok) { setErro(r.erro); return; }
    onSalvo(r.item);
  }

  return (
    <Drawer
      aberto={aberto} onFechar={onFechar}
      titulo={item ? `Editar ${item.nome}` : "Novo termo"}
      largura="w-full sm:w-[60vw] sm:min-w-[520px] sm:max-w-[880px]"
      rodape={<>
        <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
        <Button type="button" loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> {item ? "Salvar" : "Adicionar"}</Button>
      </>}
    >
      <div className="space-y-4">
        {erro && <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}
        {item && item.ativo === false && <p className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">Termo inativo: não aparece em “Carregar de um template” nas propostas até ser reativado.</p>}
        <FormField label="Nome" required>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Termo Contrato Anual" maxLength={160} />
        </FormField>
        <FormField label="Descrição">
          <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Resumo do uso deste termo" maxLength={500} />
        </FormField>
        <div>
          <p className="text-sm font-semibold text-ink mb-1.5">Variáveis (clique para inserir)</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {VARIAVEIS_TERMO.map((v) => (
              <button key={v} type="button" onClick={() => inserirVariavel(v)}
                className="inline-flex items-center gap-1 text-[11px] font-mono bg-primary-50 text-primary-700 border border-primary-100 rounded px-2 py-1 hover:bg-primary-100 transition-colors">
                {v}
              </button>
            ))}
          </div>
        </div>
        <FormField label="Conteúdo do termo">
          <Textarea ref={textareaRef} value={conteudo} onChange={(e) => setConteudo(e.target.value)} rows={12}
            placeholder="Ex.: A CONTRATADA prestará serviços de manutenção para {{cliente_nome}}..." />
        </FormField>
      </div>
    </Drawer>
  );
}
