# Frivo — Manifesto de Produto (carta-guia)

> É a instrução-mãe: toda leva, tela e decisão nasce sob estes princípios. Fica acima de principios-ux-frivo.md e do design system (identidade visual), que continuam valendo nos detalhes.

## 0. Enquadramento
O Frivo é um produto SaaS que outras empresas vão comprar e usar sozinhas, sem a gente do lado pra explicar. Projete cada tela para um estranho de outra empresa de climatização usar sozinho, de primeira, sem tutorial. A tela se defende pelo design, não pela explicação. Começamos focados em climatização/refrigeração; outras verticais virão com versão própria, nunca um genérico diluído.

## 1. O problema: "cara de IA"
O sistema passa impressão de artificial porque explica demais: caixas de orientação em cada tela, linguagem tutorial/informal, o sistema "conversando" com o usuário. Produto profissional não se explica — se revela pelo design. Se uma tela precisa de parágrafo pra ser entendida, o design falhou; conserte o design, não adicione texto.

## 2. Posicionamento
Rápido e simples como o Conta Azul; sem a burocracia lenta do OMIE; especializado, não genérico como o Field. Alvo: agilidade do Conta Azul + profundidade do Field + foco vertical em climatização que nenhum deles tem.

## 3. Princípios
1. O design explica, o texto não.
2. Menos é mais: na tela só o essencial.
3. Linguagem profissional e um vocabulário consistente (um conceito = uma palavra). Sem emoji na UI, sem tom de assistente.
4. Um jeito só de fazer cada coisa (componentes reusados).
5. Rápido e direto; o avançado fica escondido (progressive disclosure).
6. Multiempresa desde sempre; o que varia é configuração, nada hardcoded.
7. A especialização em climatização é a vantagem.
8. Densidade profissional e organizada (denso mas limpo; respiro + hierarquia).
9. O "porquê" vai pra ajuda/tooltip, não pra cada tela.
10. Consistência visual sóbria: base neutra, um acento, cor só com função, sem degradê, sem emoji, sem "desenho animado".

## 5. DO / DON'T
- Caixa de explicação no topo da tela → título claro + os dados.
- "Pronto! Seu orçamento foi criado!" → toast discreto "Orçamento criado."
- Parágrafos explicando impostos → os campos + um ⓘ.
- Emoji e tom de assistente → tom de software sério e neutro.
- Mesmo conceito com nomes diferentes → um termo só (glossário).
- Fluxo burocrático obrigatório → caminho curto por padrão; rigor como opção.
- Botão/tela reinventado por módulo → componente da casa.

---

## Referências no repositório

| O manifesto cita | Onde está |
|---|---|
| Identidade visual (`identidade-visual-frivo.md`) | **`docs/design-system.md`** — é o mesmo documento; a referência é mapeada, não duplicada |
| Princípios de UX (Princípio 7: rótulo curto + ⓘ, tom formal, caixa de frase) | `docs/principios-ux-frivo.md` |
| Diagnóstico da despoluição (lista por tela, glossário proposto, plano de ondas) | `docs/auditoria-despoluicao-2026-11-08.md` |
| Componentes e padrões oficiais que as ondas reusam (ⓘ, toast, mensagem de permissão) | `docs/componentes-base-despoluicao.md` |
| Guarda automática dos princípios 3 e 10 (ratchet com baseline) | `tests/unit/despoluicao-ratchet.test.ts` + `tests/unit/despoluicao-baseline.json` |
