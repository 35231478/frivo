# Componentes-base da despoluição (o que as Ondas 1–7 reusam)

Referência curta, por caso de uso: qual é o componente ou padrão **oficial**. As ondas aplicam; ninguém reinventa por tela (manifesto, princípio 4). Diagnóstico e plano: `docs/auditoria-despoluicao-2026-11-08.md`.

## 1. Ajuda ⓘ — `components/ui/dica.tsx` (`Dica`)

O **único** tooltip do sistema (Princípio 7). Rótulo curto na tela; o "porquê" e o detalhe vão para a ⓘ.

| Onde | Como |
|---|---|
| Campo de formulário | `<FormField label="…" dica="…">` (prop `dica`; `hint` só para mensagem curta de estado/valor) |
| Seção de formulário | `<FormSection title="…" dica="…">` |
| Título de card | `<CardTitulo dica="…">` |
| Cabeçalho de página | `<PageHeader dica="…">` (a descrição visível fica em ≤ 1 linha) |
| Switch / grupo | `ToggleSwitch` e `ToggleGroup` com `dica` |
| Cadastro padrão | `CadastroPadrao ajuda="…"` e `CampoCadastro.ajuda` (`lib/cadastros/registro.ts`) |
| Qualquer outro lugar | `<Dica rotulo="Nome do que explica" texto="…" />` ao lado do rótulo — **nunca dentro** de botão ou link clicável |

Acessibilidade garantida pelo componente (coberta em `tests/unit/dica-ui.test.ts`): `<button type="button">` com nome "Ajuda: <rótulo>", `aria-describedby` → `role="tooltip"` presente no DOM mesmo fechado; abre no hover (mouse), no toque (alterna; toque fora fecha) e no foco (teclado; Esc fecha); balão no `body`, sempre dentro da tela; o ponteiro pode entrar no balão sem ele fechar (WCAG 1.4.13); o clique na ⓘ não aciona o que está em volta (label, card clicável).

Texto da dica: 1–2 frases, voz impessoal, sem "você", sem exclamação. Se a dica passa de ~220 caracteres, o campo ou a tela está pedindo para ser redesenhado, não explicado.

## 2. Toast — `components/ui/avisos.tsx` (`toast`, `confirmar`, `<Avisos/>`)

O jeito único de avisar e confirmar (no lugar de `alert`/`confirm` e de toasts locais).

- `toast("Orçamento criado.")` — sucesso é o padrão; `toast(msg, "erro")` e `toast(msg, "info")`.
- **Texto:** frase curta com ponto final, voz impessoal. Sem "!", sem "com sucesso", sem "Pronto", sem emoji.
  - "Salvo." · "Contrato criado." · "Link copiado." · "Cobrança enviada." · "Não foi possível salvar." (erro)
  - não: "Alterações salvas com sucesso!" · "Pronto: a cobrança seguiu." · "Link copiado!"
- `confirmar({ titulo, mensagem, confirmarTexto, perigo })` para confirmação; a mensagem diz o efeito em 1–2 frases.
- Ainda existem 3 toasts locais a migrar para o oficial nas ondas das telas: `components/forms/contrato-form.tsx` (`mostrarToast`), `components/forms/cliente-form.tsx`, `components/perfil/perfil-client.tsx`; e um `toast` próprio em `components/calendario/calendario-grid.tsx`.

## 3. Mensagem de permissão

Formato único, sempre visível (não vai para ⓘ): **"Somente leitura: requer a permissão Módulo › ação."**
Exemplo: "Somente leitura: requer a permissão Equipes › editar." Substitui "Somente consulta — você não tem permissão para…" e "Você não tem permissão para…". No servidor (`lib/cadastros/especificos.ts` e rotas), a mesma voz impessoal: "Não é possível conceder acessos além dos do próprio usuário."

## 4. Cor

Só tokens de `lib/ui/tokens.ts` via classes do Tailwind (`bg-surface-*`, `text-ink*`, `acento`, `ok`, `atencao`, `atrasado`, `previsto`). Cor de status só com função (chip, ponto, valor). Nenhum hex em componente; cor escolhida pelo usuário (equipe, perfil, tipo de OS) é **dado**, e a paleta oferecida fica num só lugar (a Onda 4 centraliza `CORES`). Sem degradê, sem borda colorida à esquerda, sem emoji (ícones: `lucide-react`).

## 5. Ratchet — `tests/unit/despoluicao-ratchet.test.ts`

Roda na suíte (`npm test`, logo no CI). Varre `components/`, `app/`, `lib/cadastros`, `lib/navegacao` e `lib/permissoes.ts` (fora testes) e conta, por arquivo, seis categorias: `emoji`, `hex`, `informal`, `exclamacao`, `titleCase`, `textoLongo` (texto inline ≥ 110 c fora da ⓘ). O que cada uma detecta está no cabeçalho do teste.

**Baseline** `tests/unit/despoluicao-baseline.json`: as violações conhecidas, congeladas no diagnóstico. O teste falha quando:

1. um arquivo tem **mais** violações que o baseline → violação nova: corrija o código (o baseline nunca sobe à mão);
2. um arquivo tem **menos** (ou foi apagado/renomeado) → a limpeza aconteceu: encolha o baseline.

**Como reduzir o baseline (cada onda):**

```bash
npm run despoluicao:baseline     # regrava tests/unit/despoluicao-baseline.json com o estado atual
npm test -- tests/unit/despoluicao-ratchet.test.ts
```

O comando só regrava; confira no `git diff` do JSON que **todos** os números desceram (nenhum subiu, nenhum arquivo novo entrou) e cole no PR a tabela `totais` antes/depois. Arquivo renomeado: o número sai do nome antigo e entra no novo com valor igual ou menor. Na Onda 7 o `totais` chega a zero e o teste vira proibição plena.

Para ver as violações de um arquivo específico durante a limpeza, apague-o do JSON e rode o teste: a falha lista `arquivo:linha` e o trecho.
