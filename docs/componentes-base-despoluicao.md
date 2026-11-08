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

**Baseline fechado (Onda 7).** `tests/unit/despoluicao-baseline.json` tem `arquivos` **vazio**: fora das exceções documentadas, qualquer violação nova falha o CI. As **exceções** ficam em `excecoes` (categoria → arquivo → `{ n, motivo }`) e são só estas:

| Categoria | Arquivo | n | Por quê |
|---|---|---|---|
| titleCase | `components/ui/endereco-autocomplete.tsx` | 6 | Nomes de estados (Minas Gerais, Rio de Janeiro…): nomes próprios |
| titleCase | `components/forms/colaborador-form.tsx` | 3 | Especialidades sugeridas e tipos de documento são **gravados como valor**; mudar a caixa mudaria o dado |
| titleCase | `components/forms/tecnico-form.tsx` | 3 | Idem, no cadastro do técnico |
| textoLongo | `lib/cadastros/especificos.ts` | 8 | Avisos de impacto/bloqueio da inativação: templates com plural e nome do registro; o contador soma o código `${…}` e a regra não cabe em 110 c sem perder sentido |
| textoLongo | `lib/cadastros/servidor.ts` | 1 | Aviso genérico de inativação com artigo/singular interpolados |

O teste confere que cada exceção tem `motivo` escrito, `n > 0` e **bate exatamente** com o real: se um desses arquivos for limpo, a exceção tem de diminuir (ou sair); se piorar, falha. O teste falha quando:

1. um arquivo tem **mais** violações que o permitido (baseline ou exceção) → violação nova: corrija o código;
2. um arquivo tem **menos** que a exceção diz → a limpeza aconteceu: reduza `n` (ou apague a exceção);
3. `arquivos` deixa de ser vazio → corrija o código ou, se for um caso legítimo, documente a exceção **com motivo** e defenda no PR.

**Regravar** (`npm run despoluicao:baseline`) mantém as `excecoes` e só escreve em `arquivos` o que estiver fora delas — ou seja, depois da Onda 7 o comando deve devolver `arquivos` vazio; se não devolver, o que apareceu é bug a corrigir, não baseline a aceitar.

Para ver as violações de um arquivo específico durante a limpeza, apague-o do JSON e rode o teste: a falha lista `arquivo:linha` e o trecho.
