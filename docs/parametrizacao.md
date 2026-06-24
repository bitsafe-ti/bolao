# Parametrização do Sistema — Bolão Copa 2026

> Guia de construção de layout e padrões de implementação específicos da aplicação.
> Para paleta de cores, tipografia e tokens visuais, consultar `docs/design.md`.

---

## 1. Estrutura da Aplicação

### Tecnologia
- **Framework:** React (SPA, sem roteamento)
- **Build:** Vite · Base `/` (Cloudflare) ou `/bolao/` (GitHub Pages)
- **Estilo:** CSS puro com variáveis (`src/styles.css`)
- **Ícones:** Font Awesome 6 Free Solid (`@fortawesome/react-fontawesome`)
- **Hospedagem:** Cloudflare Pages + D1 (banco) + Workers (resultados automáticos)

### Arquivos principais
| Arquivo | Responsabilidade |
|---|---|
| `src/main.jsx` | Componente raiz único — toda a UI é renderizada condicionalmente |
| `src/styles.css` | Estilos globais + variáveis CSS |
| `src/domain.js` | Pontuação, ranking, geração de grupos |
| `src/sharedState.js` | Leitura/escrita na API Cloudflare com merge por timestamp |
| `src/resultsSync.js` | Normalização e aplicação de resultados ao vivo |
| `src/bracket.js` | Lógica do chaveamento (fase de grupos → mata-mata) |
| `src/teams.js` | Registro de seleções com código ISO 3166-1 alpha-2 |
| `src/passwords.js` | Hash PBKDF2-SHA-256 (150k iterações) |
| `functions/api/pool-state/[poolId].js` | API Cloudflare Pages Functions (GET/PUT/PATCH) |
| `workers/live-results/` | Worker agendado — sincroniza placares a cada minuto |

---

## 2. Shell de Layout

### Grid principal
```
.app-shell
├── .sidebar          (240px expandido | 56px colapsado)
└── .workspace        (flex: 1, overflow-y auto, padding 22px)
    ├── .topbar       (88px desktop | 64px mobile, sticky)
    └── conteúdo da aba ativa
```

### Sidebar
- **Expandida:** 240px, `padding: 0 14px 22px` → brand-block + nav tabs + footer
- **Colapsada:** 56px, `padding: 0 4px 14px` → só ícones + tooltip hover
- **Mobile (≤860px):** drawer fixo, abre via hambúrguer no topbar
- Estado controlado por `sidebarCollapsed` (useState) — **não** persiste entre sessões

### Topbar
- Desktop: `height: 88px`, `padding: 16px 22px`, `border-bottom: 1px solid var(--line)`
- Mobile (≤860px): `height: 64px`, `padding: 10px 14px`; em telas ≤520px, padding horizontal de 12px
- Esquerda: botão colapsar sidebar (desktop) + título da aba ativa
- Direita: avatar do usuário com dropdown (Perfil / Sair)

---

## 3. Navegação

### Abas principais (`userTabs` / `adminTabs`)
| ID | Label | Ícone FA |
|---|---|---|
| `predictions` | Palpites | `faFutbol` |
| `results` | Resultados | `faListCheck` |
| `groups` | Grupos | `faLayerGroup` |
| `bracket` | Chaveamento | `faSitemap` |
| `ranking` | Ranking | `faMedal` |
| `settings` | Configurações | `faGear` *(admin only)* |

**Padrão de estado ativo (regra universal de navegação):**
```css
/* base */
border-left: 3px solid transparent;
color: var(--muted);

/* ativo */
background: #FFF1F1;
border-left-color: #BD2124;
color: #BD2124;
font-weight: 600;

/* hover (inativo) */
background: #F5F5F5;
color: var(--text);
```
Este padrão se aplica a **todos os itens de navegação** do projeto: sidebar principal, settings sidenav e qualquer nova área de navegação.

### Persistência de navegação
- `tab` e `settingsTab` salvos em `sessionStorage` (`bol-tab`, `bol-settings-tab`)
- Restaurados no `useState` inicial — mantêm a página ao recarregar
- O `useEffect` de guarda reseta para `"predictions"` se a aba não estiver disponível

### Sub-abas de Configurações
| ID | Label |
|---|---|
| `participants` | Participantes |
| `rounds` | Rodadas |
| `audit` | Logs do sistema |

Layout: `.settings-layout` (flex-column) → `.settings-header` (título + `.settings-tabs-nav`) + `.settings-content`

Tabs horizontais: `border-bottom: 3px solid var(--primary)` no item ativo, `background: var(--primary-soft)`, `color: var(--primary)`, `font-weight: 600`. Radius `6px 6px 0 0`.

---

## 4. Padrões de Componente

### Panel
```html
<section class="panel">
  <!-- SectionHeader + conteúdo -->
</section>
```
- `padding: 20px` — apenas espaçamento interno, sem borda, raio ou sombra
- Visual flat sobre o fundo branco da página (`--bg: #ffffff`)
- Não usar `.panel` para criar separação visual por card; usar separadores tipográficos ou `border-bottom` se necessário

### SectionHeader
```jsx
<SectionHeader title="Título" caption="Descrição opcional." titleId="id-acessibilidade" />
```
- Título: `font-size: 1.15rem`, `font-weight: 700`, cor `var(--text)`
- Caption: `font-size: 0.88rem`, cor `var(--muted)`
- Alinhamento: flex-row, `justify-content: space-between`

### Botões
| Variante | Classe | Visual |
|---|---|---|
| Primário | *(padrão)* | bg `#BD2124`, texto branco, radius 8px |
| Ghost | `.ghost` | border `var(--line)`, bg transparente |
| Destrutivo | `.ghost.danger` | border + texto `#BD2124` |
| Utilitário | *(sidebar-actions)* | bg transparente, texto `var(--muted-light)` |
| Nav ativo | `.tabs button.active` / `.settings-sidenav nav button.active` | bg `#FFF1F1`, `border-left: 3px solid #BD2124`, texto `#BD2124` |

### Modal
```html
<div class="modal-backdrop">
  <section class="modal-card" role="dialog">
    <div class="modal-header"> ... </div>
    <form class="modal-form"> ... </form>
  </section>
</div>
```
- Backdrop fecha ao clicar fora (`onMouseDown` no overlay, `stopPropagation` no card)

### Dropdown de usuário
```html
<div class="topbar-user-menu">          <!-- position: relative -->
  <button class="topbar-user-button">  <!-- abre/fecha -->
  <div class="user-dropdown">          <!-- position: absolute, top: calc(100%+8px), right: 0 -->
    <button> <Icon /> Label </button>
    <button> <Icon /> Label </button>  <!-- borda-top, cor danger para Sair -->
  </div>
</div>
```
- Fecha ao clicar fora via `useEffect` + `document.addEventListener("mousedown")`

### Avatar
```jsx
<UserAvatar user={user} large={false} />
```
- Exibe foto (`avatarUrl`) ou iniciais em círculo colorido
- Tamanhos: padrão `38px`, `large` `88px`

---

## 5. Assets e Imagens

| Arquivo | Uso |
|---|---|
| `logo_bolao_transparente.png` | Logo sidebar expandida |
| `gb.png` | Logo sidebar colapsada |
| `favicon.png` | Favicon do browser |
| `taca.png` | Taça dourada — chaveamento + pódio 1º lugar |
| `taca-p.png` | Taça prateada — pódio 2º lugar |
| `taca-b.png` | Taça bronze — pódio 3º lugar |

**Filtro de cor das logos (sidebar):**
```css
filter: brightness(0.5) sepia(1) saturate(4) hue-rotate(318deg) brightness(0.75);
```
Produz aproximadamente `#BD2124` a partir de imagens brancas.

**Flags de seleções:** `flagcdn.com/{cc}.svg` via `getFlagUrl(teamId)` em `src/teams.js`

---

## 6. Ícones (Font Awesome 6 Free Solid)

Importação central em `src/main.jsx`:
```js
import { faEye, faTrophy, faTrash, faFutbol, faListCheck, faLayerGroup,
         faSitemap, faMedal, faGear, faChevronLeft, faChevronRight,
         faRightFromBracket, faUser, faUsers, faCalendarDays,
         faClipboardList } from "@fortawesome/free-solid-svg-icons";
```

| Ícone | Uso |
|---|---|
| `faFutbol` | Aba Palpites |
| `faListCheck` | Aba Resultados |
| `faLayerGroup` | Aba Grupos |
| `faSitemap` | Aba Chaveamento |
| `faMedal` | Aba Ranking |
| `faGear` | Aba Configurações |
| `faChevronLeft/Right` | Botão colapsar/expandir sidebar |
| `faRightFromBracket` | Sair (sidebar footer + dropdown) |
| `faUser` | Perfil (dropdown) |
| `faUsers` | Participantes nas configurações |
| `faCalendarDays` | Rodadas nas configurações |
| `faClipboardList` | Logs do sistema nas configurações |
| `faTrophy` | Uso interno (legado) |
| `faEye` | Visualizar senha |
| `faTrash` | Remover item |

**Padrão de ícone em botão de nav:**
```jsx
<button data-label="Label">
  <FontAwesomeIcon icon={faIcon} className="tab-icon" />
  <span className="tab-label">Label</span>
</button>
```

---

## 7. Variáveis CSS

Definidas em `:root` em `src/styles.css`:

```css
--primary:        #BD2124   /* vermelho BitSafe */
--primary-strong: #a31b1e
--primary-soft:   #FFF1F1   /* fundo item ativo */
--text:           #1E2026
--muted:          #848E9C
--muted-light:    #6A696A
--line:           #E6E8EA   /* borda padrão */
--line-warm:      #D0D3D7   /* borda forte */
--soft:           #F5F5F5   /* hover bg */
--danger:         #BD2124
```

---

## 8. Estado e Persistência

### sessionStorage
| Chave | Valor | Descrição |
|---|---|---|
| `bol-tab` | ID da aba | Aba principal ativa |
| `bol-settings-tab` | ID da sub-aba | Sub-aba de configurações ativa |

### localStorage
| Chave | Valor | Descrição |
|---|---|---|
| `bolao-copa-2026:session` | JSON | Sessão do usuário (ID + participante) |
| `bolao-copa-2026:cache` | JSON | Cache do estado remoto para offline |

### Estado remoto (Cloudflare D1)
Polling a cada 30s. Merge: remoto prevalece ao puxar, local prevalece ao publicar.

---

## 9. Regras de Construção

1. **Toda mudança visual** deve obedecer `docs/design.md` (cores, espaçamento, tipografia).
2. **Novos ícones** devem ser adicionados ao import central em `src/main.jsx` — não criar imports separados.
3. **Novas abas** devem ser adicionadas aos arrays `userTabs` / `adminTabs` com `{ id, label, icon }`.
4. **Novos painéis** usam a classe `.panel` + `<SectionHeader />`.
5. **IDs de entidade** sempre prefixados: `user-`, `participant-`, `match-`, `group-`.
6. **Datas** armazenadas como ISO 8601 sem timezone (horário de São Paulo); exibir com `formatDate()`.
7. **Commit + push + deploy** após cada alteração de código (sem perguntar).
8. **Não usar `!important`** — reorganizar especificidade no CSS.
9. **Não criar arquivos de documentação** sem pedido explícito.
10. **Não adicionar comentários de código** explicando o que o código faz — só comentar WHY não-óbvios.
