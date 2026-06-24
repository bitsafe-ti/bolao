# Design System — BitSafe Ponto Digital

> Principios estruturais inspirados na Apple, identidade de cor BitSafe.
> Layout, tipografia e componentes seguem a linguagem Apple.
> Paleta de cores e identidade de marca BitSafe são mantidas integralmente.

---

## 1. Visual Theme & Atmosphere

A linguagem visual do Ponto Digital é um sistema editorial de precisão que alterna entre clareza administrativa e blocos de informação densa. O tom permanece contido: telas neutras amplas, chrome discreto e hierarquia de informação com todo o peso expressivo. A interface é projetada para desaparecer, deixando os dados e ações do usuário em primeiro plano.

O ritmo é consistente, mas não monolítico. Telas de visão geral usam chaptering claro com áreas de respiro, enquanto telas operacionais introduzem espaçamento mais justo e controles utilitários sem quebrar a gramática visual central. O resultado é um sistema com dois modos: modo painel e modo transação.

Key Characteristics:
- Ritmo binario de seções: superficies escuras (#1E2026) alternando com campos neutros claros (#FAFAFB)
- Familia de destaque vermelha unica para semantica de ação e identidade (#BD2124)
- Dois modos operacionais: painéis de visão geral e configuradores de operação densa
- Dependencia de hierarquia tipográfica e dados reais; chrome de UI permanece visualmente fino
- Metricas de cabeçalho justas (Inter semibold) combinadas com tipografia compacta de corpo
- Geometria de capsulas como linguagem de ação (border-radius de 6px a 9999px)
- Profundidade usada com moderacao; contraste e separacao de superficie fazem o trabalho de camadas
- Ritmo multi-pagina: capitulos escuros -> campos neutros claros -> superficies brancas utilitarias

## 2. Color Palette & Roles

> Paleta de identidade BitSafe — não alterar.

### Primary
- Brand Red (#BD2124): Acoes primárias, identidade, destaques de nav, botoes de submit, status ativos.
- Dark Surface (#1E2026): Sidebar, cabecalhos escuros, texto primario em fundo claro.
- Background Light (#FAFAFB): Superficie principal de tela, bandas de feature, cards.

### Secondary & Accent
- Hover Red (#a31b1e): Estado hover/pressed do vermelho primario.
- Light Red Bg (#FFF1F1): Fundo de items ativos na nav, estados selecionados.
- Light Red Border (#FEE8E8): Bordas de containers em contexto de identidade de marca.

### Surface & Background
- Pure White (#ffffff): Fundo de listas, tabelas, seções transacionais densas.
- Background Subtle (#F5F5F5): Fundos alternativos, zebra stripes, áreas de formulario.
- Background Muted (#FAFAFB): Cards, módulos de feature, painéis laterais.
- Dark Elevated (#32313A): Superficies escuras elevadas, dropdowns dark.

### Neutrals & Text
- Text Primary (#1E2026): Corpo principal, cabecalhos em fundo claro.
- Text Secondary (#848E9C): Copias secundarias, descricoes auxiliares, metadados.
- Text Muted (#6A696A): Suporte, placeholders, legendas.
- Border Default (#E6E8EA): Divisores, contornos sutis.
- Border Strong (#D0D3D7): Contornos fortes em configuração e filtros.

### Semantic
- Success (#0ECB81): Confirmacoes, saldos positivos, aprovacoes.
- Success Bg (#E8FAF2): Fundo suave para estados de sucesso.
- Warning (#D0980B): Alertas, status de atenção, horas insuficientes.
- Error/Destructive (#BD2124): Compartilhado com vermelho de marca para erros e ações destrutivas.

### Gradient System
- Telas são predominantemente orientadas a superficie sólida. Riqueza visual vem da hierarquia tipográfica e dos dados, não de gradientes de UI.
- Telas de login usam cor estática personalizada no quadro visual esquerdo. Não usar imagem nem gradiente nesse fundo.

## 3. Typography Rules

### Font Family
- Display/Text Family: Inter, fallbacks ui-sans-serif, system-ui, -apple-system, sans-serif
- Monospace: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas (para horários, códigos, valores numericos)
- Usage Split: Inter para todos os niveis; monospace para dados quantitativos alinhados em tabelas.

### Hierarchy
| Role | Size | Weight | Line Height | Notes |
|------|------|--------|-------------|-------|
| Page Title | 24px | 700 | 1.2 | Titulos de pagina do dashboard |
| Section Heading | 20px | 700 | 1.25 | Cabecalhos de card/módulo |
| Card Title | 16px | 600 | 1.3 | Titulos de card e grupos |
| Body Primary | 14px | 400 | 1.5 | Corpo padrão, descricoes, listas |
| Body Emphasis | 14px | 600 | 1.5 | Labels enfatizados, valores-chave |
| Table Header | 11px | 600 uppercase | 1.4 | Cabecalhos de coluna de tabela |
| Control Label | 14px | 400-500 | 1.4 | Botoes, labels de helper, nav compacta |
| Micro UI | 12px | 400-600 | 1.3 | Fine print, micro labels, badges |
| Data Mono | 14px | 400-700 | 1.4 | Horarios, CPF, códigos (fonte mono) |

### Principles
- Continuidade entre tipos de pagina: mesmo DNA tipografico em painéis e fluxos operacionais.
- Compressao em escala: Display usa leading justo para parecer preciso e orientado a dados.
- Densidade legivel: Inter equilibra compacidade com ritmo vertical para listas longas.
- Escada de peso medida: 600 e o peso dominante; 700 aparece seletivamente em titulos de pagina.

### Note on Font Substitutes
- Inter está disponível gratuitamente via Google Fonts ou instalacao local.
- Para números e horários, usar font-variant-numeric: tabular-nums para alinhamento consistente.

## 4. Component Stylings

### Buttons
- Primary Fill Action: #BD2124 background, #ffffff text, border-radius 8px, padding 8px 16px.
- Tenant/Platform Primary Action: usar cor sólida configurada, #ffffff text, sem gradiente. Hover pode usar opacidade ou uma variacao escurecida da mesma cor.
- Dark Fill Action: #1E2026 background, #ffffff text, border-radius 8px.
- Ghost/Outline: border #E6E8EA, background transparente, texto #1E2026, hover bg #F5F5F5.
- Destructive: #BD2124 background ou outline para exclusoes e ações irreversiveis.
- Familia Capsule/Pill: border-radius 9999px para CTAs de destaque.
- Utility Shells: shells claros (#FAFAFB) com bordas cinza sutis (#E6E8EA) para contextos densos.

### Cards & Containers
- Cards Operacionais: cards claros em #FAFAFB ou branco com enquadramento mínimo.
- Cards Utilitarios Escuros: (#1E2026, #32313A) para overlays e módulos dark.
- Paineis Configuradores: containers arredondados (8px-12px) com borda clara.
- Modulos de Destaque: shells maiores arredondados (12px-16px) para faixas de conteúdo.

### Tables
- Cabecalho: bg #FAFAFB, texto uppercase 11px #848E9C, font-weight 600.
- Linhas: bg branco alternando com #FAFAFB (zebra), hover #FAFAFB.
- Bordas: border-bottom #E6E8EA nas linhas, sem bordas laterais.
- Celulas numéricas/horários: font-family mono, text-right.
- Tabelas largas: overflow-x-auto obrigatório, min-width explicito.

### Inputs & Forms
- Campos: bg branco, texto #1E2026, borda #E6E8EA, focus ring #BD2124 (2px).
- Select/Dropdown: mesmo padrão de input.
- Labels: 14px, font-weight 500, #1E2026, margin-bottom 6px.
- Estrategia: campos permanecem visualmente quietos para manter hierarquia de dados dominante.

### Navigation
- Sidebar Desktop: bg branco, borda-direita #E6E8EA, ativos bg #FFF1F1 texto #BD2124, hover bg #F5F5F5.
- Header: bg branco, borda-inferior #E6E8EA, altura 73px.
- Itens: 18px, gap 3px ícone, padding 10px 12px, border-radius 8px.

### Badges & Status
- Success: bg #E8FAF2, texto #0ECB81.
- Warning: bg #FEF9E7, texto #D0980B.
- Error: bg #FEE8E8, texto #BD2124.
- Secondary/Neutral: bg #F5F5F5, texto #848E9C.
- Outline: border #E6E8EA, texto #1E2026.

### Other Distinctive Components
- Tabela de Controle de Ponto: colunas de status com badges coloridos, avatar (foto ou iniciais) a esquerda do nome.
- Wizard de Configuração: painéis de opção e seletores combinando chips e blocos de resumo contextual.
- Paineis de Indicadores: capitulos que combinam tipografia editorial com dados operacionais.

## 5. Layout Principles

### Spacing System
- Unidade base 8px com micro-passos para alinhamento de precisão.
- Valores comuns: 2, 4, 6, 8, 10, 12, 16, 20, 24, 32 px.
- Padding de pagina: p-4 (mobile) / p-6 (desktop). Max-width: max-w-6xl (1152px).

### Grid & Container
- Paginas de visão geral: colunas centrais com ampla respiracao horizontal.
- Paginas operacionais: grades multi-coluna mais justas com empilhamento modular frequente.
- Container: nucleo legivel restrito com margens externas generosas.

### Whitespace Philosophy
- Capitulos principais usam ampla respiracao superior/inferior.
- Paginas operacionais comprimem espaçamento deliberadamente.
- Transicoes de seção dependem de mudancas de superficie, não de separadores decorativos.

### Border Radius Scale
- 4px: micro tags e shells minimos.
- 6px-8px: controles padrão e campos compactos.
- 8px-12px: cards, frames de módulo e painéis operacionais.
- 12px-16px: containers maiores de módulo e spotlight.
- 9999px: capsulas e formas pill.
- 50%: avatares circulares e controles de selecao.

## 6. Depth & Elevation

| Level | Treatment | Use |
|------|-----------|-----|
| Level 0 | Superficies planas (#ffffff, #FAFAFB, #1E2026) | Estagios principais de dados |
| Level 1 | Borda sutil (#E6E8EA, #D0D3D7) | Filtros, inputs, cards utilitários |
| Level 2 | Sombra suave (shadow-sm a shadow-md) | Cards destacados, módulos elevados |
| Level 3 | Dark stepped (#1E2026 -> #32313A) | Overlays, dropdowns, clusters dark |
| Accessibility | Foco vermelho (#BD2124) | Enfase de teclado e selecao |

Profundidade e intencionalmente contida. O sistema favorece contraste tonal, surface stepping e hierarquia composicional em vez de pilhas de sombra pesadas.

## 7. Do and Don'ts

### Do
- Usar (#1E2026, #FAFAFB, #ffffff) como fundacao estrutural.
- Reservar #BD2124 para ações genuinas, identidade e alertas relevantes.
- Manter tipografia justa e deliberada, especialmente em escalas de display.
- Manter a geometria capsule/circle para controles e ações-chave.
- Usar contencao liderada por borda em contextos densos.
- Tabelas largas sempre com overflow-x-auto e min-width explicito.
- Fontes monoespaco para horários, CPF, PIS, códigos e valores numericos alinhados.

### Don't
- Não introduzir paletas de acento que competem com o vermelho BitSafe.
- Não usar sombras excessivas ou gradientes decorativos no chrome central.
- Não achatar todos os cantos para um único raio; usar tiers propositais.
- Não sobrecarregar módulos operacionais com bordas grossas ou efeitos barulhentos.
- Não remover a cadência de contraste neutro entre capitulos escuros e claros.

## 8. Responsive Behavior

### Breakpoints
| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | < 640px | Coluna unica, sidebar em drawer, rows compactos |
| Tablet | 640px-768px | Cards expandidos, transicoes 1-2 colunas |
| Desktop | 768px-1024px | Layouts operacionais completos, sidebar fixa |
| Desktop Wide | 1024px-1280px | Expansao de painel e espaçamento mais amplo |
| Large Desktop | 1280px+ | Maxima respiracao de capitulo e composicao larga |

### Touch Targets
- Acoes primárias em geometrias de botão/pill amigáveis ao toque.
- Controles circulares alinhados com intento tocavel mínimo em mobile.
- UI densa usa labels compactos mas mantem regioes de hit claras via padding.

### Collapsing Strategy
- Tipografia de heroi escala para baixo em tiers discretos preservando contraste.
- Grades colapsam de multi-coluna para cards empilhados com seletores persistentes.
- Navegacao utilitaria comprime em agrupamentos simples preservando ações-chave.
- Clusters de configuração se tornam verticalmente sequenciados em mobile.

## 9. Agent Prompt Guide

### Quick Color Reference
- Acao primaria / identidade: Brand Red (#BD2124)
- Hover/pressed primario: Hover Red (#a31b1e)
- Fundo claro principal: Background Light (#FAFAFB)
- Superficie alternativa: Background Subtle (#F5F5F5)
- Texto primario em claro: Text Primary (#1E2026)
- Texto secundario: Text Secondary (#848E9C)
- Borda padrão suave: Border Default (#E6E8EA)
- Borda forte: Border Strong (#D0D3D7)
- Sucesso: Success (#0ECB81) / bg (#E8FAF2)
- Aviso: Warning (#D0980B)
- Erro: Error (#BD2124) / bg (#FEE8E8)

### Example Component Prompts
- "Projete um heroi de painel no fundo claro (#FAFAFB) com Inter semibold 24px, copia de suporte concisa e dois CTAs capsule usando #BD2124 e #1E2026."
- "Crie um painel de configuração operacional no branco (#ffffff) com cards de 8px de raio, campos de borda #E6E8EA, Inter 14px corpo e seletores de opção compactos."
- "Construa uma grade de cards de dados alternando #FAFAFB e branco, com cards primeiro-em-dados, sombras contidas e metadados Inter 12px."
- "Componha um ritmo de pagina misto painel + operacional: capitulo de showcase escuro -> capitulo de feature claro -> módulo de lista de dados denso mantendo vermelho apenas para ações."

### Iteration Guide
1. Travar a fundacao neutra (#1E2026, #FAFAFB, #ffffff) antes de ajustar acentos.
2. Manter vermelho escasso e proposital; se tudo for vermelho, a hierarquia colapsa.
3. Ajustar tipografia: escala display -> legibilidade do corpo -> micro labels.
4. Combinar raio por classe de componente (campo, card, capsule, circulo).
5. Aumentar densidade ao mover de seções de painel para operacionais.
6. Validar que a hierarquia de dados permanece a camada visual mais forte apos cada revisao.

### Known Gaps
- Cores de status semantico compartilham o vermelho de marca com ações primárias — usar com contexto claro.
- Alguns micro-estados de interação variam por módulo e não são representados como tokens universais.

---

## 10. Bolão Copa — Padrões Específicos

> Esta seção cobre padrões implementados no Bolão Copa 2026 que estendem o design system base.
> Para arquitetura, assets, ícones e regras de construção consultar `docs/parametrizacao.md`.

### Shell de Layout

O app-shell usa flex-row com sidebar fixa e área de workspace:
- **Sidebar expandida:** 240px, `padding: 22px 14px`, bg `#ffffff`, `border-right: 1px solid var(--line)`
- **Sidebar colapsada:** 56px, `padding: 22px 4px 14px` — o `padding-top: 22px` é idêntico ao expandido para alinhar o brand-block com o topbar (topbar termina em y=95: `padding 16px + altura 73px`)
- **Workspace:** `padding: 22px`, background `#ffffff`
- **Topbar:** `min-height: 73px`, bg `#ffffff`, `border-bottom: 1px solid #E6E8EA`, sticky no topo

### Sidebar — Brand Block
```css
.brand-logo    { filter: brightness(0.5) sepia(1) saturate(4) hue-rotate(318deg) brightness(0.75); }
.brand-favicon { filter: brightness(0.5) sepia(1) saturate(4) hue-rotate(318deg) brightness(0.75);
                 width: 42px; height: 42px; object-fit: contain; }
```
O filtro converte imagens PNG brancas para `#BD2124`. Logo expandida: `logo_bolao_transparente.png`. Logo colapsada: `gb.png`.

### Padrão Universal de Item de Navegação Ativo

> **Regra:** todo item de navegação do projeto usa este padrão de estado ativo, sem exceção.

```css
/* Estado base (inativo) */
border-left: 3px solid transparent;
color: var(--muted);          /* #848e9c */
background: transparent;

/* Estado ativo */
background: #FFF1F1;
border-left-color: #BD2124;
color: #BD2124;
font-weight: 600;

/* Hover (apenas quando inativo) */
background: #F5F5F5;
color: var(--text);
```

Aplica-se a: `.tabs button` (sidebar principal), `.settings-sidenav nav button` (settings), e qualquer nova área de navegação adicionada ao projeto.

Mobile: substitui `border-left` por `border-bottom` quando os itens ficam horizontais.

Colapsado — ícone único + tooltip via CSS:
```css
button::after { content: attr(data-label); position: absolute; left: calc(100% + 12px);
  background: #1E2026; color: #fff; padding: 5px 10px; border-radius: 6px;
  font-size: 0.78rem; white-space: nowrap; opacity: 0; pointer-events: none; }
button:hover::after { opacity: 1; }
```

### Topbar — Dropdown de Usuário

Posicionamento relativo ao botão:
```css
.user-dropdown { position: absolute; top: calc(100% + 8px); right: 0;
  background: #ffffff; border: 1px solid #E6E8EA; border-radius: 10px;
  box-shadow: 0 8px 24px rgba(30,32,38,0.12); min-width: 160px; z-index: 300; }
```

Itens com ícone + label (`gap: 10px`). Item "Sair": `border-top: 1px solid #E6E8EA`, `color: #BD2124`, hover bg `#fee8e8`.

Fecha ao clicar fora: `useRef` + `document.addEventListener("mousedown")` removido no cleanup.

### Settings — Layout Dois-Colunas

```css
.settings-layout { display: flex; align-items: flex-start; gap: 20px; }
.settings-sidenav { width: 200px; flex-shrink: 0; position: sticky; top: 0; }
.settings-content { flex: 1; min-width: 0; }
@media (max-width: 860px) { .settings-layout { flex-direction: column; }
  .settings-sidenav { width: 100%; position: static; } }
```

Item ativo no sidenav: `background: #FFF1F1; color: #BD2124; font-weight: 600;`

### Responsividade Mobile (≤860px)

- Sidebar vira drawer fixo overlay, abre via hambúrguer no topbar
- Settings-layout empilha verticalmente, sidenav vira nav horizontal com `flex-wrap: wrap`
- Perfil e rankings usam `width: 100%` sem `max-width`
