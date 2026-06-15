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

  /* ============ CSV PARSER ============
     Formato esperado (igual ao oficial da Caixa):
     Linha 1: título / data de geração
     Linha 2: cabeçalhos separados por ';'
     Linhas seguintes: dados separados por ';'
     Encoding: ISO-8859-1 (latin1) ou UTF-8 — detectamos pelo BOM/heurística
  */
  function parseCaixaCSV(text){
    // normaliza quebras de linha
    const lines = text.split(/\r\n|\r|\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) throw new Error('Arquivo vazio ou em formato inesperado.');

    // tenta achar a data de geração na primeira linha
    let genDate = null;
    const dateMatch = lines[0].match(/(\d{2}\/\d{2}\/\d{4})/);
    if (dateMatch) genDate = dateMatch[1];

    // acha a linha de cabeçalho (contém "N° do imóvel" ou "UF;Cidade")
    let headerIdx = -1;
    for (let i=0; i<Math.min(lines.length, 5); i++){
      if (/UF;\s*Cidade|N[°ºo]\s*do\s*im[oó]vel/i.test(lines[i])){
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) headerIdx = 1; // fallback: assume linha 2

    const headers = lines[headerIdx].split(';').map(h => h.trim().toLowerCase());

    const colIndex = (names) => {
      for (const name of names){
        const idx = headers.findIndex(h => h.includes(name));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const idx = {
      cod: colIndex(['imóvel','imovel']),
      uf: colIndex(['uf']),
      cidade: colIndex(['cidade']),
      bairro: colIndex(['bairro']),
      endereco: colIndex(['endereço','endereco']),
      preco: colIndex(['preço','preco']),
      avaliacao: colIndex(['avaliação','avaliacao']),
      desconto: colIndex(['desconto']),
      financiamento: colIndex(['financiamento']),
      descricao: colIndex(['descrição','descricao']),
      modalidade: colIndex(['modalidade']),
      link: colIndex(['link'])
    };

    if (idx.cod === -1 || idx.preco === -1 || idx.cidade === -1){
      throw new Error('Não foi possível identificar as colunas esperadas no arquivo. Verifique se o formato é o mesmo do CSV da Caixa.');
    }

    const parseBRNumber = (s) => {
      if (s == null) return null;
      s = String(s).trim();
      if (s === '' || s === '-') return null;
      s = s.replace(/\./g, '').replace(',', '.');
      const n = parseFloat(s);
      return isNaN(n) ? null : n;
    };

    const parseDescricao = (desc) => {
      const out = { tipo:'', area:null, area_priv:null, quartos:null, vagas:null };
      if (!desc) return out;
      out.tipo = desc.split(',')[0].trim();
      let m = desc.match(/([\d]+\.[\d]+|\d+)\s*de\s*área\s*total/i) || desc.match(/([\d]+\.[\d]+|\d+)\s*de\s*area\s*total/i);
      if (m) out.area = parseFloat(m[1]);
      m = desc.match(/([\d]+\.[\d]+|\d+)\s*de\s*área\s*privativa/i) || desc.match(/([\d]+\.[\d]+|\d+)\s*de\s*area\s*privativa/i);
      if (m) out.area_priv = parseFloat(m[1]);
      m = desc.match(/(\d+)\s*qto/i);
      if (m) out.quartos = parseInt(m[1], 10);
      m = desc.match(/(\d+)\s*vaga/i);
      if (m) out.vagas = parseInt(m[1], 10);
      return out;
    };

    const out = [];
    for (let i = headerIdx+1; i < lines.length; i++){
      const cols = lines[i].split(';');
      if (cols.length < 3) continue;
      const codRaw = (cols[idx.cod] || '').trim();
      if (!codRaw || !/\d/.test(codRaw)) continue;

      const desc = idx.descricao !== -1 ? (cols[idx.descricao] || '').trim() : '';
      const parsedDesc = parseDescricao(desc);

      let descontoRaw = idx.desconto !== -1 ? (cols[idx.desconto]||'').trim() : '';
      let desconto = null;
      if (descontoRaw !== ''){
        desconto = parseFloat(descontoRaw.replace(',', '.'));
        if (!isNaN(desconto)) desconto = desconto / 100;
        else desconto = null;
      }

      out.push({
        cod: codRaw.replace(/\D/g,''),
        uf: idx.uf !== -1 ? (cols[idx.uf]||'').trim() : '',
        cidade: (cols[idx.cidade]||'').trim(),
        bairro: idx.bairro !== -1 ? (cols[idx.bairro]||'').trim() : '',
        endereco: idx.endereco !== -1 ? (cols[idx.endereco]||'').trim() : '',
        tipo: parsedDesc.tipo,
        area: parsedDesc.area,
        area_priv: parsedDesc.area_priv,
        quartos: parsedDesc.quartos,
        vagas: parsedDesc.vagas,
        preco: parseBRNumber(cols[idx.preco]),
        avaliacao: idx.avaliacao !== -1 ? parseBRNumber(cols[idx.avaliacao]) : null,
        desconto: desconto,
        financiamento: idx.financiamento !== -1 ? (cols[idx.financiamento]||'').trim() : '',
        modalidade: idx.modalidade !== -1 ? (cols[idx.modalidade]||'').trim() : '',
        link: idx.link !== -1 ? (cols[idx.link]||'').trim() : ''
      });
    }

    return { rows: out, genDate };
  }

  /* tenta decodificar como UTF-8; se aparecerem caracteres de replacement, tenta latin1 */
  function decodeFile(arrayBuffer){
    const utf8 = new TextDecoder('utf-8').decode(arrayBuffer);
    if (utf8.includes('\uFFFD')){
      return new TextDecoder('iso-8859-1').decode(arrayBuffer);
    }
    return utf8;
  }

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
    { key: 'link', label: 'Edital', sortable: false }
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
    document.getElementById('sourceStatus').innerHTML = 'Carregando base atualizada…';

    fetch('./data.json', { cache: 'no-store' })
      .then(resp => {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(payload => {
        const items = payload.items || [];
        if (!items.length) throw new Error('Base online vazia.');
        const dateLabel = payload.source_date || '—';
        let updatedLabel = '';
        if (payload.generated_at){
          try {
            const d = new Date(payload.generated_at);
            updatedLabel = ` · atualizado em ${d.toLocaleDateString('pt-BR')}`;
          } catch(e){}
        }
        setLoadedData(items, dateLabel,
          `<span class="ok">●</span> Base online (Brasil) — <span class="file-name">${items.length.toLocaleString('pt-BR')} imóveis${updatedLabel}</span>`
        );
      })
      .catch(err => {
        console.warn('Falha ao carregar data.json, usando base de exemplo embutida:', err);
        if (FALLBACK_DATA.length){
          setLoadedData(FALLBACK_DATA, '—',
            `<span style="color:var(--clay)">●</span> Base de exemplo (offline) — <span class="file-name">${FALLBACK_DATA.length.toLocaleString('pt-BR')} imóveis · não foi possível carregar a base online</span>`
          );
        } else {
          setLoadedData([], '—', `<span style="color:var(--bad)">●</span> Não foi possível carregar dados. Carregue um CSV manualmente.`);
        }
      });
  }

  function loadCSVFile(file){
    document.getElementById('loadingOverlay').classList.remove('hidden');
    document.getElementById('loadingText').textContent = 'Lendo arquivo…';

    const reader = new FileReader();
    reader.onload = function(e){
      try {
        const text = decodeFile(e.target.result);
        document.getElementById('loadingText').textContent = 'Processando registros…';
        setTimeout(()=>{
          try {
            const { rows, genDate } = parseCaixaCSV(text);
            if (rows.length === 0) throw new Error('Nenhum imóvel encontrado no arquivo.');
            DATA = rows;
            document.getElementById('genDate').textContent = genDate || '—';
            document.getElementById('sourceStatus').innerHTML =
              `<span class="ok">●</span> Base carregada — <span class="file-name">${escapeHtml(file.name)} · ${DATA.length.toLocaleString('pt-BR')} imóveis</span>`;
            populateSelects();
            resetFilterInputs();
            applyFilters();
          } catch(err){
            alert('Erro ao processar o arquivo: ' + err.message);
          } finally {
            document.getElementById('loadingOverlay').classList.add('hidden');
          }
        }, 50);
      } catch(err){
        document.getElementById('loadingOverlay').classList.add('hidden');
        alert('Erro ao ler o arquivo: ' + err.message);
      }
    };
    reader.onerror = function(){
      document.getElementById('loadingOverlay').classList.add('hidden');
      alert('Não foi possível ler o arquivo.');
    };
    reader.readAsArrayBuffer(file);
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

    document.getElementById('btnLoadFile').addEventListener('click', ()=>{
      document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', (e)=>{
      const file = e.target.files[0];
      if (file) loadCSVFile(file);
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
    render(); // mostra estado vazio inicial (KPIs zerados, tabela/ranking vazios)
  });
})();
