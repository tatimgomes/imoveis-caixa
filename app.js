(function(){
  "use strict";

  /* ============ ESTADO ============ */
  let DATA = []; // dados normalizados, formato compacto: cod, uf, cidade, bairro, endereco, tipo, area, quartos, vagas, preco, avaliacao, desconto, financiamento, modalidade, link
  let FILTERED = [];
  let currentPage = 1;
  const PAGE_SIZE = 25;
  let sortState = { field: 'desconto', dir: 'desc' };

  const fmtBRL = (v) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
  const fmtBRL0 = (v) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', {minimumFractionDigits:0, maximumFractionDigits:0});
  const fmtPct = (v) => v == null ? '—' : (Number(v)*100).toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1}) + '%';
  const fmtNum = (v, dec=0) => v == null ? '—' : Number(v).toLocaleString('pt-BR', {minimumFractionDigits:dec, maximumFractionDigits:dec});

  /* ============ MULTISELECT (componente customizado) ============ */
  // estado: cada multiselect guarda os valores selecionados em um Set
  const MS_STATE = {
    msUF: new Set(),
    msCidade: new Set(),
    msTipo: new Set(),
    msModalidade: new Set()
  };

  function uniqueSorted(arr){
    return Array.from(new Set(arr.filter(v => v != null && v !== ''))).sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'));
  }

  // monta (uma vez) a estrutura interna de cada multiselect
  function buildMultiselect(id){
    const root = document.getElementById(id);
    root.innerHTML = `
      <button type="button" class="ms-trigger">
        <span class="ms-label placeholder">${root.dataset.placeholder}</span>
        <span class="ms-caret">▾</span>
      </button>
      <div class="ms-panel">
        <input type="text" class="ms-search" placeholder="buscar…">
        <div class="ms-options"></div>
        <div class="ms-actions">
          <button type="button" class="ms-select-all">Selecionar todos</button>
          <button type="button" class="ms-clear">Limpar</button>
        </div>
      </div>
    `;

    const trigger = root.querySelector('.ms-trigger');
    const search = root.querySelector('.ms-search');
    const selectAllBtn = root.querySelector('.ms-select-all');
    const clearBtn = root.querySelector('.ms-clear');

    trigger.addEventListener('click', (e)=>{
      e.stopPropagation();
      const wasOpen = root.classList.contains('open');
      closeAllMultiselects();
      if (!wasOpen){
        root.classList.add('open');
        search.value = '';
        filterMsOptions(id, '');
        search.focus();
      }
    });

    search.addEventListener('input', ()=>{
      filterMsOptions(id, search.value.trim().toLowerCase());
    });

    selectAllBtn.addEventListener('click', ()=>{
      const visibleValues = getMsVisibleValues(id, search.value.trim().toLowerCase());
      visibleValues.forEach(v => MS_STATE[id].add(v));
      refreshMsOptionStates(id);
      onMultiselectChange(id);
    });

    clearBtn.addEventListener('click', ()=>{
      MS_STATE[id].clear();
      refreshMsOptionStates(id);
      onMultiselectChange(id);
    });

    root.addEventListener('click', (e)=> e.stopPropagation());
  }

  function getMsVisibleValues(id, query){
    const root = document.getElementById(id);
    const opts = root.querySelectorAll('.ms-option');
    const out = [];
    opts.forEach(opt=>{
      if (!query || opt.dataset.label.toLowerCase().includes(query)){
        out.push(opt.dataset.value);
      }
    });
    return out;
  }

  function filterMsOptions(id, query){
    const root = document.getElementById(id);
    const opts = root.querySelectorAll('.ms-option');
    let anyVisible = false;
    opts.forEach(opt=>{
      const match = !query || opt.dataset.label.toLowerCase().includes(query);
      opt.style.display = match ? '' : 'none';
      if (match) anyVisible = true;
    });
    const emptyEl = root.querySelector('.ms-empty');
    if (emptyEl) emptyEl.style.display = anyVisible ? 'none' : '';
  }

  function refreshMsOptionStates(id){
    const root = document.getElementById(id);
    root.querySelectorAll('.ms-option input').forEach(cb=>{
      cb.checked = MS_STATE[id].has(cb.value);
    });
    updateMsTriggerLabel(id);
  }

  function updateMsTriggerLabel(id){
    const root = document.getElementById(id);
    const label = root.querySelector('.ms-label');
    const countEl = root.querySelector('.ms-count');
    const selected = MS_STATE[id];

    if (selected.size === 0){
      label.textContent = root.dataset.placeholder;
      label.classList.add('placeholder');
      if (countEl) countEl.remove();
    } else {
      label.classList.remove('placeholder');
      if (selected.size === 1){
        label.textContent = Array.from(selected)[0];
      } else {
        label.textContent = `${selected.size} selecionados`;
      }
      if (!countEl){
        const span = document.createElement('span');
        span.className = 'ms-count';
        root.querySelector('.ms-trigger').insertBefore(span, root.querySelector('.ms-caret'));
      }
      root.querySelector('.ms-count').textContent = selected.size;
    }
  }

  // atualiza as opções disponíveis (chamado quando os dados mudam ou quando UF filtra cidades)
  function setMultiselectOptions(id, values){
    const root = document.getElementById(id);
    const optionsContainer = root.querySelector('.ms-options');

    // remove seleções que não existem mais nas novas opções
    const valueSet = new Set(values);
    MS_STATE[id] = new Set(Array.from(MS_STATE[id]).filter(v => valueSet.has(v)));

    optionsContainer.innerHTML = '';
    if (values.length === 0){
      optionsContainer.innerHTML = '<div class="ms-empty">Nenhuma opção disponível</div>';
    } else {
      values.forEach(v=>{
        const label = document.createElement('label');
        label.className = 'ms-option';
        label.dataset.value = v;
        label.dataset.label = v;
        label.innerHTML = `<input type="checkbox" value="${escapeAttr(v)}"><span class="ms-opt-label">${escapeHtml(v)}</span>`;
        const cb = label.querySelector('input');
        cb.checked = MS_STATE[id].has(v);
        cb.addEventListener('change', ()=>{
          if (cb.checked) MS_STATE[id].add(v);
          else MS_STATE[id].delete(v);
          updateMsTriggerLabel(id);
          onMultiselectChange(id);
        });
        optionsContainer.appendChild(label);
      });
      const emptyEl = document.createElement('div');
      emptyEl.className = 'ms-empty';
      emptyEl.style.display = 'none';
      emptyEl.textContent = 'Nenhuma opção encontrada';
      optionsContainer.appendChild(emptyEl);
    }

    updateMsTriggerLabel(id);
  }

  function escapeAttr(s){
    return String(s).replace(/"/g, '&quot;');
  }

  function closeAllMultiselects(){
    document.querySelectorAll('.multiselect.open').forEach(el => el.classList.remove('open'));
  }

  function onMultiselectChange(id){
    if (id === 'msUF') updateCidadeOptions();
    applyFilters();
  }

  /* ============ POPULAR OPÇÕES ============ */
  function populateSelects(){
    const ufs = uniqueSorted(DATA.map(d=>d.uf));
    const tipos = uniqueSorted(DATA.map(d=>d.tipo));
    const modalidades = uniqueSorted(DATA.map(d=>d.modalidade));

    setMultiselectOptions('msUF', ufs);
    setMultiselectOptions('msTipo', tipos);
    setMultiselectOptions('msModalidade', modalidades);

    updateCidadeOptions();
  }

  function updateCidadeOptions(){
    const selectedUFs = MS_STATE.msUF;
    const pool = selectedUFs.size ? DATA.filter(d=>selectedUFs.has(d.uf)) : DATA;
    const cidades = uniqueSorted(pool.map(d=>d.cidade));
    setMultiselectOptions('msCidade', cidades);
  }

  /* ============ FILTRAGEM ============ */
  function applyFilters(){
    const search = document.getElementById('fSearch').value.trim().toLowerCase();
    const ufs = MS_STATE.msUF;
    const cidades = MS_STATE.msCidade;
    const tipos = MS_STATE.msTipo;
    const modalidades = MS_STATE.msModalidade;
    const precoMin = parseFloat(document.getElementById('fPrecoMin').value);
    const precoMax = parseFloat(document.getElementById('fPrecoMax').value);
    const descontoMin = parseInt(document.getElementById('fDesconto').value, 10) / 100;
    const quartosMin = document.getElementById('fQuartos').value ? parseInt(document.getElementById('fQuartos').value,10) : null;
    const financ = document.getElementById('fFinanciamento').checked;

    FILTERED = DATA.filter(d=>{
      if (ufs.size && !ufs.has(d.uf)) return false;
      if (cidades.size && !cidades.has(d.cidade)) return false;
      if (tipos.size && !tipos.has(d.tipo)) return false;
      if (modalidades.size && !modalidades.has(d.modalidade)) return false;
      if (!isNaN(precoMin) && (d.preco == null || d.preco < precoMin)) return false;
      if (!isNaN(precoMax) && (d.preco == null || d.preco > precoMax)) return false;
      if (descontoMin > 0 && (d.desconto == null || d.desconto < descontoMin)) return false;
      if (quartosMin != null && (d.quartos == null || d.quartos < quartosMin)) return false;
      if (financ && d.financiamento.toLowerCase() !== 'sim') return false;
      if (search){
        const hay = (d.cidade+' '+d.bairro+' '+d.endereco+' '+d.cod).toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    currentPage = 1;
    render();
  }

  /* ============ KPIs ============ */
  function renderKPIs(){
    document.getElementById('resultCount').textContent = FILTERED.length.toLocaleString('pt-BR');
    document.getElementById('kpiTotal').textContent = FILTERED.length.toLocaleString('pt-BR');
    document.getElementById('kpiTotalSub').textContent = `de ${DATA.length.toLocaleString('pt-BR')} na base`;

    if (FILTERED.length === 0){
      document.getElementById('kpiDesconto').textContent = '—';
      document.getElementById('kpiPreco').textContent = '—';
      document.getElementById('kpiPrecoSub').textContent = 'faixa: —';
      document.getElementById('kpiM2').textContent = '—';
      document.getElementById('kpiM2Sub').textContent = '—';
      return;
    }

    const descontos = FILTERED.map(d=>d.desconto).filter(v=>v!=null);
    const avgDesconto = descontos.length ? descontos.reduce((a,b)=>a+b,0)/descontos.length : null;
    document.getElementById('kpiDesconto').textContent = fmtPct(avgDesconto);

    const precos = FILTERED.map(d=>d.preco).filter(v=>v!=null);
    const avgPreco = precos.length ? precos.reduce((a,b)=>a+b,0)/precos.length : null;
    document.getElementById('kpiPreco').textContent = fmtBRL0(avgPreco);
    if (precos.length){
      document.getElementById('kpiPrecoSub').textContent = `faixa: ${fmtBRL0(Math.min(...precos))} – ${fmtBRL0(Math.max(...precos))}`;
    }

    const withArea = FILTERED.filter(d=>getAreaRef(d) != null && d.preco != null);
    if (withArea.length){
      const m2vals = withArea.map(d=>d.preco/getAreaRef(d));
      const avgM2 = m2vals.reduce((a,b)=>a+b,0)/m2vals.length;
      document.getElementById('kpiM2').textContent = fmtBRL0(avgM2);
      document.getElementById('kpiM2Sub').textContent = `${withArea.length.toLocaleString('pt-BR')} imóveis com área informada (privativa, ou total quando não há privativa)`;
    } else {
      document.getElementById('kpiM2').textContent = '—';
      document.getElementById('kpiM2Sub').textContent = 'sem dados de área no filtro atual';
    }
  }

  /* ============ RANKING ============ */
  function renderRanking(){
    const grid = document.getElementById('rankingGrid');
    grid.innerHTML = '';

    const ranked = FILTERED
      .filter(d => d.desconto != null && d.preco != null)
      .sort((a,b)=> b.desconto - a.desconto)
      .slice(0, 12);

    if (ranked.length === 0){
      grid.innerHTML = DATA.length === 0
        ? '<div class="empty-state">Nenhum dado carregado. Clique em "Carregar base de imóveis" no topo da página.</div>'
        : '<div class="empty-state">Nenhum imóvel encontrado com os filtros atuais.</div>';
      return;
    }

    ranked.forEach((d, i)=>{
      const a = document.createElement('a');
      a.className = 'rank-card';
      a.href = d.link || '#';
      a.target = '_blank';
      a.rel = 'noopener';
      a.innerHTML = `
        <span class="rank-badge">#${i+1}</span>
        <div class="rc-city">${escapeHtml(d.cidade)}${d.uf ? ' · '+escapeHtml(d.uf) : ''}</div>
        <div class="rc-addr">${escapeHtml(d.bairro || d.endereco || '—')}</div>
        <div class="rc-prices">
          <div class="rc-price">${fmtBRL0(d.preco)}</div>
          <div class="rc-discount">−${fmtPct(d.desconto)}</div>
        </div>
        <div class="rc-meta">
          <span>${escapeHtml(d.tipo || '—')}${d.area_priv ? ' · '+fmtNum(d.area_priv,0)+' m² (priv.)' : (d.area ? ' · '+fmtNum(d.area,0)+' m² (total)' : '')}</span>
          <span>${escapeHtml(d.modalidade || '')}</span>
        </div>
      `;
      grid.appendChild(a);
    });
  }

  function escapeHtml(s){
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  /* ============ TABELA ============ */
  const TABLE_COLUMNS = [
    { key: 'cidade', label: 'Cidade', sortable: true },
    { key: 'bairro', label: 'Bairro', sortable: true },
    { key: 'tipo', label: 'Tipo', sortable: true },
    { key: 'area', label: 'Área total (m²)', sortable: true, num: true },
    { key: 'area_priv', label: 'Área priv. (m²)', sortable: true, num: true },
    { key: 'quartos', label: 'Qts', sortable: true, num: true },
    { key: 'preco', label: 'Preço', sortable: true, num: true },
    { key: 'avaliacao', label: 'Avaliação', sortable: true, num: true },
    { key: 'desconto', label: 'Desconto', sortable: true, num: true },
    { key: 'precom2', label: 'R$/m²', sortable: true, num: true },
    { key: 'modalidade', label: 'Modalidade', sortable: false },
    { key: 'link', label: 'Edital', sortable: false },
    { key: 'avaliar', label: 'Viabilidade', sortable: false }
  ];

  // área de referência para cálculo de R$/m²: prioriza privativa, cai para total
  function getAreaRef(d){
    if (d.area_priv && d.area_priv > 0) return d.area_priv;
    if (d.area && d.area > 0) return d.area;
    return null;
  }

  function renderTableHead(){
    const row = document.getElementById('tableHeadRow');
    row.innerHTML = '';
    TABLE_COLUMNS.forEach(col=>{
      const th = document.createElement('th');
      if (col.num) th.classList.add('num');
      let arrow = '';
      if (sortState.field === col.key){
        arrow = `<span class="arrow">${sortState.dir==='asc'?'▲':'▼'}</span>`;
      }
      th.innerHTML = `${col.label}${arrow}`;
      if (col.sortable){
        th.addEventListener('click', ()=>{
          if (sortState.field === col.key){
            sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
          } else {
            sortState.field = col.key;
            sortState.dir = col.num ? 'desc' : 'asc';
          }
          document.getElementById('sortField').value = '';
          render();
        });
      }
      row.appendChild(th);
    });
  }

  function getSortValue(d, field){
    if (field === 'precom2'){
      const areaRef = getAreaRef(d);
      return (areaRef && d.preco != null) ? d.preco / areaRef : null;
    }
    return d[field];
  }

  function sortedData(){
    // aplica sort do dropdown se selecionado
    const dropdown = document.getElementById('sortField').value;
    let field = sortState.field, dir = sortState.dir;
    if (dropdown){
      const map = {
        'desconto_desc': ['desconto','desc'],
        'preco_asc': ['preco','asc'],
        'preco_desc': ['preco','desc'],
        'precom2_asc': ['precom2','asc'],
        'area_desc': ['area','desc']
      };
      [field, dir] = map[dropdown];
    }

    const arr = FILTERED.slice();
    arr.sort((a,b)=>{
      let va = getSortValue(a, field);
      let vb = getSortValue(b, field);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string'){
        const cmp = va.localeCompare(vb, 'pt-BR');
        return dir === 'asc' ? cmp : -cmp;
      }
      return dir === 'asc' ? va - vb : vb - va;
    });
    return arr;
  }

  function renderTable(){
    const arr = sortedData();
    const totalPages = Math.max(1, Math.ceil(arr.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage-1) * PAGE_SIZE;
    const pageItems = arr.slice(start, start + PAGE_SIZE);

    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';

    if (pageItems.length === 0){
      const msg = DATA.length === 0
        ? 'Nenhum dado carregado. Clique em "Carregar base de imóveis" no topo da página.'
        : 'Nenhum imóvel encontrado com os filtros atuais.';
      tbody.innerHTML = `<tr><td colspan="${TABLE_COLUMNS.length}"><div class="empty-state">${msg}</div></td></tr>`;
    } else {
      pageItems.forEach(d=>{
        const tr = document.createElement('tr');
        const areaRef = getAreaRef(d);
        const precom2 = (areaRef && d.preco != null) ? d.preco / areaRef : null;
        let discClass = '';
        if (d.desconto != null){
          if (d.desconto >= 0.4) discClass = 'high';
          else if (d.desconto >= 0.2) discClass = 'mid';
          else discClass = 'low';
        }
        tr.innerHTML = `
          <td>${escapeHtml(d.cidade)}${d.uf?' <span style="opacity:0.5">('+escapeHtml(d.uf)+')</span>':''}</td>
          <td>${escapeHtml(d.bairro || '—')}</td>
          <td>${escapeHtml(d.tipo || '—')}</td>
          <td class="num">${d.area ? fmtNum(d.area,2) : '—'}</td>
          <td class="num">${d.area_priv ? fmtNum(d.area_priv,2) : '—'}</td>
          <td class="num">${d.quartos != null ? d.quartos : '—'}</td>
          <td class="num">${fmtBRL0(d.preco)}</td>
          <td class="num">${fmtBRL0(d.avaliacao)}</td>
          <td class="num discount-cell ${discClass}">${fmtPct(d.desconto)}</td>
          <td class="num">${precom2 ? fmtBRL0(precom2) : '—'}</td>
          <td>${escapeHtml(d.modalidade || '—')}</td>
          <td>${d.link ? `<a class="tbl-link" href="${d.link}" target="_blank" rel="noopener">ver imóvel</a>` : '—'}</td>
          <td><button type="button" class="btn-viab" data-cod="${escapeAttr(d.cod)}">Avaliar</button></td>
        `;
        tbody.appendChild(tr);
      });
    }

    document.getElementById('pageInfo').textContent =
      arr.length ? `Mostrando ${start+1}–${Math.min(start+PAGE_SIZE, arr.length)} de ${arr.length.toLocaleString('pt-BR')}` : 'Nenhum resultado';

    renderPager(totalPages);
  }

  function renderPager(totalPages){
    const pager = document.getElementById('pager');
    pager.innerHTML = '';

    const mkBtn = (label, page, disabled, active) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (disabled) b.disabled = true;
      if (active) b.style.borderColor = 'var(--clay)';
      b.addEventListener('click', ()=>{ currentPage = page; render(); });
      return b;
    };

    pager.appendChild(mkBtn('« Anterior', currentPage-1, currentPage<=1, false));

    // simples: mostra no máximo 5 páginas ao redor da atual
    let pages = [];
    const maxBtns = 5;
    let startP = Math.max(1, currentPage - Math.floor(maxBtns/2));
    let endP = Math.min(totalPages, startP + maxBtns - 1);
    startP = Math.max(1, endP - maxBtns + 1);
    for (let p=startP; p<=endP; p++) pages.push(p);

    pages.forEach(p=>{
      pager.appendChild(mkBtn(String(p), p, false, p===currentPage));
    });

    pager.appendChild(mkBtn('Próxima »', currentPage+1, currentPage>=totalPages, false));
  }

  /* ============ RENDER GERAL ============ */
  function render(){
    renderKPIs();
    renderRanking();
    renderTable();
  }

  /* ============ CARREGAMENTO DE DADOS ============ */

  // pequeno conjunto de dados embutido, usado apenas se o fetch de data.json falhar
  // (ex: abrindo o arquivo localmente via file://, sem servidor http)
  const FALLBACK_DATA = window.FALLBACK_DATA || [];

  function setLoadedData(items, dateLabel, statusHtml){
    DATA = items || [];
    document.getElementById('genDate').textContent = dateLabel || '—';
    document.getElementById('sourceStatus').innerHTML = statusHtml;
    populateSelects();
    applyFilters();
  }

  function loadOnlineData(){
    document.getElementById('sourceStatus').innerHTML = 'Carregando índice da base…';

    fetch('./data.json', { cache: 'no-store' })
      .then(resp => {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(index => {
        const ufs = index.ufs || [];
        if (!ufs.length) throw new Error('Índice da base vazio.');

        document.getElementById('sourceStatus').innerHTML =
          `Carregando dados de ${ufs.length} estados… (0/${ufs.length})`;

        let loaded = 0;
        const fetches = ufs.map(entry =>
          fetch('./' + entry.file, { cache: 'no-store' })
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + entry.file); return r.json(); })
            .then(items => {
              loaded++;
              document.getElementById('sourceStatus').innerHTML =
                `Carregando dados de ${ufs.length} estados… (${loaded}/${ufs.length})`;
              return items;
            })
        );

        return Promise.all(fetches).then(arraysOfItems => {
          const items = arraysOfItems.flat();
          if (!items.length) throw new Error('Base online vazia.');

          const dateLabel = index.source_date || '—';
          let updatedLabel = '';
          if (index.generated_at){
            try {
              const d = new Date(index.generated_at);
              const dataStr = d.toLocaleDateString('pt-BR');
              const horaStr = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
              updatedLabel = ` · última atualização: ${dataStr} às ${horaStr}`;
            } catch(e){}
          }
          setLoadedData(items, dateLabel,
            `<span class="ok">●</span> Base online (Brasil) — <span class="file-name">${items.length.toLocaleString('pt-BR')} imóveis${updatedLabel}</span>`
          );
        });
      })
      .catch(err => {
        console.warn('Falha ao carregar a base online, usando base de exemplo embutida:', err);
        if (FALLBACK_DATA.length){
          setLoadedData(FALLBACK_DATA, '—',
            `<span style="color:var(--clay)">●</span> Base de exemplo (offline) — <span class="file-name">${FALLBACK_DATA.length.toLocaleString('pt-BR')} imóveis · não foi possível carregar a base online</span>`
          );
        } else {
          setLoadedData([], '—', `<span style="color:var(--bad)">●</span> Não foi possível carregar os dados. Clique em "Atualizar dados" para tentar novamente.`);
        }
      });
  }

  function resetFilterInputs(){
    document.getElementById('fSearch').value = '';
    MS_STATE.msUF.clear();
    MS_STATE.msCidade.clear();
    MS_STATE.msTipo.clear();
    MS_STATE.msModalidade.clear();
    refreshMsOptionStates('msUF');
    refreshMsOptionStates('msCidade');
    refreshMsOptionStates('msTipo');
    refreshMsOptionStates('msModalidade');
    document.getElementById('fPrecoMin').value = '';
    document.getElementById('fPrecoMax').value = '';
    document.getElementById('fDesconto').value = 0;
    document.getElementById('fDescontoValue').textContent = '0% ou mais';
    document.getElementById('fQuartos').value = '';
    document.getElementById('fFinanciamento').checked = false;
  }

  /* ============ CALCULADORA DE VIABILIDADE ============ */
  // Replica as fórmulas da planilha "Calculadora de viabilidade financeira".
  // Campos editáveis: input/select sem atributo "disabled".
  // Campos calculados: inputs com atributo "disabled" (atualizados via JS).

  const VIAB_INPUT_IDS = [
    'vValorCompra','vValorVenda','vPrazo','vRoiMinimo',
    'vTaxaItbi','vRegistro','vEmolumentos',
    'vIptuMensal','vCondominioMensal','vReformaPorM2',
    'vFinanciamento','vPercEntrada',
    'vComissaoCorretor','vAdvogado','vAssessoria','vPercDividaCondominio','vPercDividaIptu','vAliquotaIr'
  ];

  // área e avaliação do imóvel selecionado (valores numéricos, vêm da base oficial e são somente leitura no modal)
  let viabCurrentArea = 0;
  let viabCurrentAvaliacao = 0;

  function viabNum(id){
    const el = document.getElementById(id);
    if (!el) return 0;
    if (el.tagName === 'SELECT') return el.value;
    const v = parseFloat(el.value);
    return isNaN(v) ? 0 : v;
  }

  function viabSetOutput(id, value){
    const el = document.getElementById(id);
    if (el) el.value = fmtBRL(value);
  }

  function viabFindItemByCod(cod){
    return DATA.find(d => String(d.cod) === String(cod));
  }

  function openViabModal(cod){
    const item = viabFindItemByCod(cod);
    if (!item) return;

    // descrição da oportunidade (somente leitura)
    document.getElementById('vTipo').value = item.tipo || '—';
    document.getElementById('vCidade').value = `${item.cidade || ''}${item.uf ? ' / ' + item.uf : ''}`;
    document.getElementById('vModalidade').value = item.modalidade || '—';

    const areaRef = getAreaRef(item);
    viabCurrentArea = areaRef || 0;
    viabCurrentAvaliacao = item.avaliacao != null ? item.avaliacao : 0;
    document.getElementById('vArea').value = areaRef ? `${fmtNum(areaRef,2)} m²` : '—';
    document.getElementById('vAvaliacao').value = fmtBRL(item.avaliacao);
    document.getElementById('vLanceMinimo').value = fmtBRL(item.preco);

    // negócio: pré-preenche valor de compra com o preço/lance da Caixa,
    // e valor esperado de venda com o valor de avaliação (ponto de partida editável)
    document.getElementById('vValorCompra').value = item.preco != null ? item.preco : 0;
    document.getElementById('vValorVenda').value = item.avaliacao != null ? item.avaliacao : 0;
    document.getElementById('vPrazo').value = 6;
    document.getElementById('vRoiMinimo').value = 30;

    // documentação (defaults da planilha)
    document.getElementById('vTaxaItbi').value = 2;
    document.getElementById('vRegistro').value = 0;
    document.getElementById('vEmolumentos').value = 0;

    // manutenção e reforma
    document.getElementById('vIptuMensal').value = 0;
    document.getElementById('vCondominioMensal').value = 0;
    document.getElementById('vReformaPorM2').value = 350;

    // pagamento
    document.getElementById('vFinanciamento').value = 'Não';
    document.getElementById('vPercEntrada').value = 0;

    // despesas na venda e outras
    document.getElementById('vComissaoCorretor').value = 6;
    document.getElementById('vAdvogado').value = 0;
    document.getElementById('vAssessoria').value = 0;
    // "dívidas eventuais": 10% do valor de avaliação para condomínio + 10% para IPTU (editável)
    document.getElementById('vPercDividaCondominio').value = 10;
    document.getElementById('vPercDividaIptu').value = 10;
    document.getElementById('vAliquotaIr').value = 15;

    const subtitleParts = [];
    if (item.bairro) subtitleParts.push(item.bairro);
    if (item.endereco) subtitleParts.push(item.endereco);
    document.getElementById('viabSubtitle').textContent = subtitleParts.join(' · ') || '—';

    viabRecalc();

    document.getElementById('viabOverlay').classList.remove('hidden');
  }

  function closeViabModal(){
    document.getElementById('viabOverlay').classList.add('hidden');
  }

  // ===== Lógica de cálculo (fórmulas da planilha) =====
  function viabRecalc(){
    // --- Negócio ---
    const valorCompra = viabNum('vValorCompra');       // B17
    const valorVenda = viabNum('vValorVenda');         // B18
    const prazo = viabNum('vPrazo');                   // B19
    const roiMinimo = viabNum('vRoiMinimo') / 100;     // B20

    // comissão do leiloeiro: 5% se modalidade for 1º/2º Leilão ou Licitação Aberta, senão 0 (B14)
    const modalidade = document.getElementById('vModalidade').value || '';
    const comissaoLeiloeiroPerc = /^(1º Leilão|2º Leilão|Licitação Aberta)$/i.test(modalidade.trim()) ? 0.05 : 0;
    const comissaoLeiloeiroValor = comissaoLeiloeiroPerc * valorCompra; // B35
    document.getElementById('vComissaoLeiloeiro').value = `${(comissaoLeiloeiroPerc*100).toFixed(0)}% — ${fmtBRL(comissaoLeiloeiroValor)}`;

    // --- Documentação ---
    const taxaItbi = viabNum('vTaxaItbi') / 100;  // F5
    const registro = viabNum('vRegistro');        // F7
    const emolumentos = viabNum('vEmolumentos');  // F8
    const valorItbi = taxaItbi * valorCompra;     // F6
    const totalDocumentacao = valorItbi + registro + emolumentos; // F9
    viabSetOutput('vValorItbi', valorItbi);
    viabSetOutput('vTotalDocumentacao', totalDocumentacao);

    // --- Manutenção e reforma ---
    const iptuMensal = viabNum('vIptuMensal');           // F12
    const condominioMensal = viabNum('vCondominioMensal'); // F13
    const reformaPorM2 = viabNum('vReformaPorM2');       // 350 na planilha
    const area = viabCurrentArea;                        // B11 (somente leitura, vem da base)
    const reformaTotal = area * reformaPorM2;            // F16
    const acumuladoVenda = (iptuMensal + condominioMensal) * prazo; // B42
    viabSetOutput('vReformaTotal', reformaTotal);
    viabSetOutput('vAcumuladoVenda', acumuladoVenda);

    // --- Pagamento / financiamento ---
    const financiamento = document.getElementById('vFinanciamento').value; // B23
    const percEntrada = viabNum('vPercEntrada') / 100;   // B24
    const isFinanciado = financiamento === 'Sim';

    const valorEntrada = percEntrada * valorCompra;      // B25
    const valorFinanciado = isFinanciado ? (valorCompra - valorEntrada) : 0; // B26
    const parcela = valorFinanciado * 0.0097;            // B27
    const saldoPrazoVenda = valorFinanciado * (1 - 0.0023809375 * prazo); // B28

    viabSetOutput('vValorEntrada', valorEntrada);
    viabSetOutput('vValorFinanciado', valorFinanciado);
    viabSetOutput('vParcela', parcela);
    viabSetOutput('vSaldoPrazoVenda', saldoPrazoVenda);

    // --- Despesas na venda ---
    const comissaoCorretorPerc = viabNum('vComissaoCorretor') / 100; // F19
    const valorComissao = comissaoCorretorPerc * valorVenda;          // F20
    viabSetOutput('vValorComissao', valorComissao);

    // --- Outras despesas ---
    const advogado = viabNum('vAdvogado');           // F23
    const assessoria = viabNum('vAssessoria');       // F24

    // dívidas eventuais: percentual do valor de avaliação, configurável (default 10% + 10%)
    const percDividaCondominio = viabNum('vPercDividaCondominio') / 100;
    const percDividaIptu = viabNum('vPercDividaIptu') / 100;
    const valorDividaCondominio = percDividaCondominio * viabCurrentAvaliacao;
    const valorDividaIptu = percDividaIptu * viabCurrentAvaliacao;
    viabSetOutput('vValorDividaCondominio', valorDividaCondominio);
    viabSetOutput('vValorDividaIptu', valorDividaIptu);

    const outrasEventuais = valorDividaCondominio + valorDividaIptu; // F25
    const totalOutrasDespesas = advogado + assessoria + outrasEventuais; // F26
    viabSetOutput('vTotalOutrasDespesas', totalOutrasDespesas);

    // --- Capital à vista (B32 = soma B33:B36) ---
    const lanceAVista = isFinanciado ? 0 : valorCompra;       // B33
    const entradaFinanciamento = isFinanciado ? valorEntrada : 0; // B34
    // B35 = comissaoLeiloeiroValor, B36 = totalDocumentacao
    const capitalVista = lanceAVista + entradaFinanciamento + comissaoLeiloeiroValor + totalDocumentacao; // B32

    // --- Despesas mensais até a venda (B38 = soma B39:B41), acumulado B42 = B38*prazo ---
    const prestacaoFinanciamento = isFinanciado ? parcela : 0; // B39
    const despesasMensais = prestacaoFinanciamento + iptuMensal + condominioMensal; // B38
    const acumuladoAteVenda = despesasMensais * prazo; // B42 (substitui o cálculo anterior simplificado)
    viabSetOutput('vAcumuladoVenda', acumuladoAteVenda);

    // --- Total de despesas (F32 = B32 + B42 + F16 + F26) ---
    const totalDespesas = capitalVista + acumuladoAteVenda + reformaTotal + totalOutrasDespesas; // F32

    // --- Receita líquida (F34 = B18 - F20 - (saldoPrazoVenda se financiado)) ---
    const receitaLiquida = valorVenda - valorComissao - (isFinanciado ? saldoPrazoVenda : 0); // F34

    // --- Lucro bruto (F36 = F34 - F32) ---
    const lucroBruto = receitaLiquida - totalDespesas; // F36

    // --- Imposto de renda ---
    const aliquotaIr = viabNum('vAliquotaIr') / 100; // F39
    let valorIr;
    if (!isFinanciado){
      // F40 = (B18 - B17 - B36 - F16 - B35 - F20) * F39
      valorIr = (valorVenda - valorCompra - totalDocumentacao - reformaTotal - comissaoLeiloeiroValor - valorComissao) * aliquotaIr;
    } else {
      // F41 = (B18 - F20 - B36 - B35 - B28 - B25 - (prazo*B27) - F16) * F39
      valorIr = (valorVenda - valorComissao - totalDocumentacao - comissaoLeiloeiroValor - saldoPrazoVenda - valorEntrada - (prazo*parcela) - reformaTotal) * aliquotaIr;
    }
    valorIr = Math.max(0, valorIr);
    viabSetOutput('vValorIr', valorIr);

    // --- Lucro líquido (F43 = F34 - F32 - IR) ---
    const lucroLiquido = receitaLiquida - totalDespesas - valorIr; // F43

    // --- ROI (F45 = F43 / F32, onde F32 aqui é o "Total de despesas" usado como capital empregado) ---
    const roi = totalDespesas !== 0 ? (lucroLiquido / totalDespesas) : 0;

    viabSetOutput('vCapitalVista', capitalVista);
    viabSetOutput('vTotalDespesas', totalDespesas);
    viabSetOutput('vReceitaLiquida', receitaLiquida);
    viabSetOutput('vLucroBruto', lucroBruto);

    const hlLucro = document.getElementById('vHlLucro');
    hlLucro.textContent = fmtBRL0(lucroLiquido);
    hlLucro.className = 'viab-hl-value ' + (lucroLiquido >= 0 ? 'positive' : 'negative');

    const hlRoi = document.getElementById('vHlRoi');
    hlRoi.textContent = fmtPct(roi);
    hlRoi.className = 'viab-hl-value ' + (roi >= roiMinimo ? 'positive' : 'negative');

    document.getElementById('vHlRoiMin').textContent = fmtPct(roiMinimo);
  }

  function bindViabEvents(){
    document.getElementById('viabClose').addEventListener('click', closeViabModal);
    document.getElementById('viabOverlay').addEventListener('click', (e)=>{
      if (e.target.id === 'viabOverlay') closeViabModal();
    });

    VIAB_INPUT_IDS.forEach(id=>{
      const el = document.getElementById(id);
      if (!el) return;
      const evt = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(evt, viabRecalc);
    });

    // delegação: botões "Avaliar" são recriados a cada render da tabela
    document.getElementById('tableBody').addEventListener('click', (e)=>{
      const btn = e.target.closest('.btn-viab');
      if (btn) openViabModal(btn.dataset.cod);
    });
  }

  /* ============ EVENTOS ============ */
  function bindEvents(){
    ['fSearch','fPrecoMin','fPrecoMax','fQuartos'].forEach(id=>{
      document.getElementById(id).addEventListener('input', applyFilters);
    });
    document.getElementById('fFinanciamento').addEventListener('change', applyFilters);

    document.getElementById('fDesconto').addEventListener('input', (e)=>{
      document.getElementById('fDescontoValue').textContent = `${e.target.value}% ou mais`;
      applyFilters();
    });

    document.getElementById('sortField').addEventListener('change', ()=>{ currentPage=1; render(); });

    document.getElementById('btnClearFilters').addEventListener('click', ()=>{
      resetFilterInputs();
      updateCidadeOptions();
      applyFilters();
    });

    document.getElementById('btnReset').addEventListener('click', ()=>{
      resetFilterInputs();
      loadOnlineData();
    });

    // fecha multiselects ao clicar fora
    document.addEventListener('click', closeAllMultiselects);
  }

  /* ============ INIT ============ */
  document.addEventListener('DOMContentLoaded', function(){
    renderTableHead();
    buildMultiselect('msUF');
    buildMultiselect('msCidade');
    buildMultiselect('msTipo');
    buildMultiselect('msModalidade');
    bindEvents();
    bindViabEvents();
    loadOnlineData();
  });
})();
