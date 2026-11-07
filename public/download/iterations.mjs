const list = document.querySelector('#iterationTimeline');
const search = document.querySelector('#historySearch');
const clear = document.querySelector('#clearSearch');
const status = document.querySelector('#historyStatus');
const count = document.querySelector('#recordCount');
const filters = [...document.querySelectorAll('.iteration-filters button')];
let activeFilter = 'all';
let records = [];

function plain(value = '') {
  const template = document.createElement('template');
  template.innerHTML = value.replace(/<br\s*\/?\s*>/gi, ' ');
  return (template.content.textContent || '').replace(/\s+/g, ' ').replace(/[`*_#]/g, '').trim();
}

function categoryOf(entry) {
  const text = `${entry.type} ${entry.summary}`.toLowerCase();
  return /(修复|修正|兼容|安全|优化|维护|核验|死循环|失败|漏洞)/.test(text) ? 'fix' : 'feature';
}

function render() {
  const query = search.value.trim().toLowerCase();
  const shown = records.filter((entry) => {
    const matchesFilter = activeFilter === 'all' || categoryOf(entry) === activeFilter;
    const matchesQuery = !query || `${entry.date} ${entry.version || ''} ${entry.summary} ${entry.type || ''} ${entry.source || ''}`.toLowerCase().includes(query);
    return matchesFilter && matchesQuery;
  });
  count.textContent = String(shown.length);
  status.textContent = shown.length ? `显示 ${shown.length} 条记录` : '没有找到匹配的迭代记录。';
  clear.hidden = !search.value;
  list.replaceChildren();

  shown.forEach((entry) => {
    const item = document.createElement('li');
    item.className = entry.milestone ? 'iteration-record iteration-milestone' : 'iteration-record';
    const formattedDate = entry.date.replaceAll('-', '.') + (entry.date.length === 7 ? '*' : '');
    const detail = plain(entry.summary);
    const summary = detail.length > 220 ? `${detail.slice(0, 220)}…` : detail;
    const article = document.createElement('article');
    article.className = 'iteration-card';
    const top = document.createElement('div');
    top.className = 'iteration-card-top';
    const version = document.createElement('span');
    version.className = 'iteration-version';
    version.textContent = `哦狐 ${entry.version}`;
    const build = entry.build ? document.createElement('span') : null;
    if (build) {
      build.className = 'iteration-build';
      build.textContent = `BUILD ${entry.build}`;
    }
    const kind = document.createElement('span');
    kind.className = 'iteration-kind';
    kind.textContent = entry.type || '版本记录';
    top.append(version, ...(build ? [build] : []), kind);
    const description = document.createElement('p');
    description.className = 'iteration-summary';
    description.textContent = summary;
    article.append(top, description);
    if (entry.source) {
      const source = document.createElement('small');
      source.className = 'iteration-source';
      source.textContent = `记录来源：${entry.source}`;
      article.append(source);
    }
    if (detail.length > 220) {
      const details = document.createElement('details');
      const label = document.createElement('summary');
      label.textContent = '展开查看详细记录';
      const full = document.createElement('p');
      full.className = 'iteration-detail';
      full.textContent = detail;
      details.append(label, full);
      article.append(details);
    }
    const time = document.createElement('time');
    time.className = 'iteration-date';
    time.dateTime = entry.date;
    const dateLabel = document.createElement('b');
    dateLabel.textContent = formattedDate;
    time.append(dateLabel, document.createTextNode(entry.milestone ? '版本起点' : '版本发布记录'));
    item.append(time, article);
    list.append(item);
  });

}

try {
  const response = await fetch('/download/iterations.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  records = data.filter((entry) => /^2026-\d\d(?:-\d\d)?$/.test(entry.date) && entry.version).sort((a, b) => b.date.localeCompare(a.date) || Number(b.build || 0) - Number(a.build || 0));
  render();
} catch (error) {
  status.textContent = '迭代记录暂时无法载入，请刷新页面后重试。';
  console.error('Failed to load OHU iteration history', error);
}

search.addEventListener('input', render);
clear.addEventListener('click', () => { search.value = ''; search.focus(); render(); });
filters.forEach((button) => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter;
  filters.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  render();
}));
