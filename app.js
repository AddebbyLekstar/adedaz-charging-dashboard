// ===== CONFIGURATION =====
const SHEET_ID = '17p_OfNljq6YXQrYEq4W-4t9rNfOLSvApSwoVMfsuy7U';
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Month abbreviations for auto-detection
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ===== STATE =====
let detectedSheets = [];    // auto-discovered sheet names
let allData = {};           // { 'Jan 2026': [...], 'Feb 2026': [...], ... }
let activeMonth = 'all';
let sortColumn = 0;
let sortAsc = true;
let charts = {};

// ===== AUTO-DETECT SHEETS =====
async function discoverSheets() {
    try {
        // Fetch the HTML view page which contains actual sheet tab names in JavaScript
        const htmlUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview`;
        const resp = await fetch(htmlUrl);
        if (!resp.ok) throw new Error('Could not fetch sheet metadata');
        const html = await resp.text();

        // Parse tab names from items.push({name: "Jan 2026", ...}) entries
        const regex = /items\.push\(\{name:\s*"([^"]+)"/g;
        const sheets = [];
        let match;
        while ((match = regex.exec(html)) !== null) {
            sheets.push(match[1]);
        }

        if (sheets.length > 0) return sheets;

        // Fallback: if parsing fails, gracefully fail without mocking data
        return [];
    } catch (err) {
        console.warn('Sheet discovery failed:', err);
        return [];
    }
}


// ===== DATA FETCHING =====
function buildCsvUrl(sheetName) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

async function fetchAllData() {
    const results = {};
    for (const sheetName of detectedSheets) {
        try {
            const resp = await fetch(buildCsvUrl(sheetName));
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const csv = await resp.text();
            results[sheetName] = parseCsv(csv, sheetName);
        } catch (err) {
            console.error(`Failed to fetch ${sheetName}:`, err);
            results[sheetName] = [];
        }
    }
    return results;
}

// ===== CSV PARSING =====
function parseCsv(csv, sheetName) {
    const lines = csv.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    // Detect date format from header
    const headerCells = parseCsvLine(lines[0]);
    const headerDate = clean(headerCells[0]).toLowerCase();
    const dateFormat = headerDate.includes('d/m') ? 'DMY' : 'MDY';

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i]);
        const rawDate = clean(cells[0]);

        if (!rawDate || rawDate.toLowerCase() === 'totals' || rawDate === '') continue;

        const date = parseDate(rawDate, dateFormat);
        if (!date) continue;

        const revenue = parseNum(cells[2]);
        const managerPayout = parseNum(cells[3]);
        const expensesRaw = clean(cells[4]);
        const deposited = parseNum(cells[5]);
        const totalGross = parseNum(cells[6]);
        const pureProfit = parseNum(cells[7]);

        if (revenue === 0 && totalGross === 0 && pureProfit === 0) continue;

        const expenses = parseExpenses(expensesRaw);

        rows.push({
            date,
            day: clean(cells[1]),
            revenue,
            managerPayout,
            expensesRaw,
            expensesParsed: expenses,
            totalExpenses: expenses.total,
            deposited,
            totalGross,
            pureProfit,
            month: sheetName
        });
    }
    return rows;
}

function parseCsvLine(line) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
            else inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            cells.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    cells.push(current);
    return cells;
}

function clean(val) { return (val || '').replace(/^"|"$/g, '').trim(); }

// XSS protection: escape user-sourced strings before inserting into HTML
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function parseNum(val) {
    const cleaned = clean(val).replace(/,/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
}

function parseDate(raw, dateFormat) {
    const parts = raw.split('/').map(Number);
    if (parts.length < 3 || parts.some(isNaN)) return null;
    let day, month, year;
    if (dateFormat === 'DMY') { [day, month, year] = parts; }
    else { [month, day, year] = parts; }
    if (year < 100) year += 2000;
    return new Date(year, month - 1, day);
}

function parseExpenses(raw) {
    if (!raw) return { fuel: 0, oil: 0, charger: 0, tape: 0, marker: 0, other: 0, total: 0, items: [] };
    const items = [];
    let fuel = 0, oil = 0, charger = 0, tape = 0, marker = 0, other = 0;
    const patterns = raw.split(/[,.]/).map(s => s.trim()).filter(Boolean);
    for (const part of patterns) {
        let match = part.match(/^(\d+)\s+(.+)$/i) || part.match(/^(.+?)\s+(\d+)$/i);
        if (match) {
            let amount, category;
            if (/^\d+$/.test(match[1])) { amount = parseInt(match[1]); category = match[2].trim().toLowerCase(); }
            else { amount = parseInt(match[2]); category = match[1].trim().toLowerCase(); }
            items.push({ amount, category });
            if (category.includes('fuel')) fuel += amount;
            else if (category.includes('oil') || category.includes('engine')) oil += amount;
            else if (category.includes('charger')) charger += amount;
            else if (category.includes('tape')) tape += amount;
            else if (category.includes('marker')) marker += amount;
            else other += amount;
        }
    }
    return { fuel, oil, charger, tape, marker, other, total: fuel + oil + charger + tape + marker + other, items };
}

// ===== DATA HELPERS =====
function getFilteredData() {
    if (activeMonth === 'all') {
        return Object.values(allData).flat();
    }
    return allData[activeMonth] || [];
}

function getAllDataSorted() {
    return Object.values(allData).flat().sort((a, b) => a.date - b.date);
}

function sum(arr, key) { return arr.reduce((s, r) => s + (r[key] || 0), 0); }
function avg(arr, key) { return arr.length ? sum(arr, key) / arr.length : 0; }

function formatCurrency(n) { return '₦' + Math.abs(n).toLocaleString('en-NG', { maximumFractionDigits: 0 }); }
function formatCurrencyShort(n) {
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs >= 1000000) return sign + '₦' + (abs / 1000000).toFixed(1) + 'M';
    if (abs >= 1000) return sign + '₦' + (abs / 1000).toFixed(0) + 'K';
    return sign + '₦' + abs;
}

// ===== DYNAMIC MONTH BUTTONS =====
function renderMonthButtons() {
    const selector = document.getElementById('monthSelector');

    let btns = `<button class="month-btn active" data-month="all" onclick="setActiveMonth('all')">All Months</button>`;

    for (const name of detectedSheets) {
        const safeName = escapeHtml(name);
        const attrName = escapeHtml(name.replace(/['"\\\\]/g, ''));
        btns += `<button class="month-btn" data-month="${attrName}" onclick="setActiveMonth('${attrName}')">${safeName}</button>`;
    }

    selector.innerHTML = btns;

    // Populate the records month dropdown
    const monthDropdown = document.getElementById('monthDropdown');
    if (monthDropdown) {
        let opts = `<option value="">— Select Month —</option>`;
        for (const name of detectedSheets) {
            const safeName = escapeHtml(name);
            const attrName = escapeHtml(name.replace(/['"\\\\]/g, ''));
            opts += `<option value="${attrName}">${safeName}</option>`;
        }
        monthDropdown.innerHTML = opts;
    }
}

// ===== KPI CARDS =====
function renderKPIs() {
    const data = getFilteredData();
    const months = Object.keys(allData).filter(k => allData[k].length > 0);
    const lastMonth = months.length >= 2 ? allData[months[months.length - 1]] : [];
    const prevMonth = months.length >= 2 ? allData[months[months.length - 2]] : [];

    // Profit margin
    const totalRev = sum(data, 'revenue');
    const totalProfit = sum(data, 'pureProfit');
    const profitMargin = totalRev > 0 ? (totalProfit / totalRev * 100) : 0;

    // Fuel ratio
    const totalFuel = data.reduce((s, r) => s + r.expensesParsed.fuel, 0);
    const fuelRatio = totalRev > 0 ? (totalFuel / totalRev * 100) : 0;

    const metrics = [
        {
            id: 'revenue', label: 'Total Revenue', value: totalRev,
            avg: avg(data, 'revenue'),
            prev: sum(prevMonth, 'revenue'), curr: sum(lastMonth, 'revenue'),
            icon: '💰'
        },
        {
            id: 'expenses', label: 'Total Expenses',
            value: sum(data, 'totalExpenses') + sum(data, 'managerPayout'),
            avg: avg(data, 'totalExpenses') + avg(data, 'managerPayout'),
            prev: sum(prevMonth, 'totalExpenses') + sum(prevMonth, 'managerPayout'),
            curr: sum(lastMonth, 'totalExpenses') + sum(lastMonth, 'managerPayout'),
            icon: '📊'
        },
        {
            id: 'gross', label: 'Total Gross', value: sum(data, 'totalGross'),
            avg: avg(data, 'totalGross'),
            prev: sum(prevMonth, 'totalGross'), curr: sum(lastMonth, 'totalGross'),
            icon: '📈'
        },
        {
            id: 'profit', label: 'Pure Profits', value: totalProfit,
            avg: avg(data, 'pureProfit'),
            prev: sum(prevMonth, 'pureProfit'), curr: sum(lastMonth, 'pureProfit'),
            icon: '✨'
        },
        {
            id: 'margin', label: 'Profit Margin', value: profitMargin,
            isPercent: true,
            prev: sum(prevMonth, 'revenue') > 0 ? (sum(prevMonth, 'pureProfit') / sum(prevMonth, 'revenue') * 100) : 0,
            curr: sum(lastMonth, 'revenue') > 0 ? (sum(lastMonth, 'pureProfit') / sum(lastMonth, 'revenue') * 100) : 0,
            icon: '📐'
        },
        {
            id: 'fuel', label: 'Total Fuel Cost', value: totalFuel,
            avg: data.length ? totalFuel / data.length : 0,
            prev: prevMonth.reduce((s, r) => s + r.expensesParsed.fuel, 0),
            curr: lastMonth.reduce((s, r) => s + r.expensesParsed.fuel, 0),
            icon: '⛽'
        },
        {
            id: 'fuelratio', label: 'Fuel / Revenue', value: fuelRatio,
            isPercent: true,
            prev: sum(prevMonth, 'revenue') > 0 ? (prevMonth.reduce((s, r) => s + r.expensesParsed.fuel, 0) / sum(prevMonth, 'revenue') * 100) : 0,
            curr: sum(lastMonth, 'revenue') > 0 ? (lastMonth.reduce((s, r) => s + r.expensesParsed.fuel, 0) / sum(lastMonth, 'revenue') * 100) : 0,
            icon: '⛽'
        }
    ];

    const classMap = { revenue: 'revenue', expenses: 'expenses', gross: 'gross', profit: 'profit', margin: 'margin', fuel: 'fuel', fuelratio: 'fuelratio' };

    const grid = document.getElementById('kpiGrid');
    grid.innerHTML = metrics.map(m => {
        const change = m.prev > 0 ? ((m.curr - m.prev) / m.prev * 100) : 0;
        const trendClass = change > 0 ? (m.id === 'expenses' || m.id === 'fuelratio' || m.id === 'fuel' ? 'down' : 'up') : change < 0 ? (m.id === 'expenses' || m.id === 'fuelratio' || m.id === 'fuel' ? 'up' : 'down') : 'neutral';
        const trendIcon = change > 0 ? '↑' : change < 0 ? '↓' : '→';
        const prevName = months.length >= 2 ? months[months.length - 2].split(' ')[0] : 'prev';
        const trendLabel = `vs ${prevName}`;

        const displayValue = m.isPercent ? `${m.value.toFixed(1)}%` : formatCurrency(m.value);
        const avgDisplay = m.isPercent ? '' : `<div class="kpi-card__avg">Daily avg: ${formatCurrency(m.avg)}</div>`;

        return `
      <div class="kpi-card kpi-card--${classMap[m.id]} animate-in">
        <div class="kpi-card__icon">${m.icon}</div>
        <div class="kpi-card__label">${m.label}</div>
        <div class="kpi-card__value">${displayValue}</div>
        <div class="kpi-card__trend ${trendClass}">
          <span>${trendIcon}</span>
          <span>${Math.abs(change).toFixed(1)}% ${trendLabel}</span>
        </div>
        ${avgDisplay}
      </div>
    `;
    }).join('');
}

// ===== BEST/WORST DAY ALERTS =====
function renderAlerts() {
    const data = getFilteredData();
    const container = document.getElementById('alertsPanel');
    if (data.length === 0) { container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem;">No data available</p>'; return; }

    const sorted = [...data].sort((a, b) => b.pureProfit - a.pureProfit);
    const best3 = sorted.slice(0, 3);
    const worst3 = sorted.slice(-3).reverse();


    container.innerHTML = `
    <div class="alerts-grid">
      <div class="alert-column alert-column--best">
        <div class="alert-column__title">🏆 Top 3 Best Days</div>
        ${best3.map((r, i) => `
          <div class="alert-item alert-item--best animate-in">
            <span class="alert-rank">#${i + 1}</span>
            <span class="alert-date">${r.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} (${escapeHtml(r.day.trim())})</span>
            <span class="alert-value cell-positive">${formatCurrency(r.pureProfit)}</span>
            <span class="alert-revenue">Rev: ${formatCurrency(r.revenue)}</span>
          </div>
        `).join('')}
      </div>
      <div class="alert-column alert-column--worst">
        <div class="alert-column__title">⚠️ Bottom 3 Days</div>
        ${worst3.map((r, i) => `
          <div class="alert-item alert-item--worst animate-in">
            <span class="alert-rank">#${data.length - 2 + i}</span>
            <span class="alert-date">${r.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} (${escapeHtml(r.day.trim())})</span>
            <span class="alert-value ${r.pureProfit >= 0 ? 'cell-positive' : 'cell-negative'}">${r.pureProfit < 0 ? '-' : ''}${formatCurrency(r.pureProfit)}</span>
            <span class="alert-revenue">Rev: ${formatCurrency(r.revenue)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ===== BREAK-EVEN CALCULATOR =====
function renderBreakEven() {
    const data = getFilteredData();
    const container = document.getElementById('breakEvenPanel');
    if (data.length === 0) { container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem;">No data available</p>'; return; }

    const avgDailyExpenses = avg(data, 'totalExpenses');
    const avgManagerPayout = avg(data, 'managerPayout');
    const avgProfitCut = data.length > 0 ? avg(data, 'pureProfit') : 0;

    // Break-even = avg daily operating costs (expenses + manager payout)
    // Pure profit formula seems to be: totalGross - 10800 (base cost), so break-even ≈ total cost base
    // From data: revenue - expenses - managerPayout = totalGross (approx)
    // pureProfit = totalGross - baseCost
    // We approximate: break-even revenue = expenses + managerPayout + baseCost where profit = 0
    // Simple: avg daily costs = avg(revenue) - avg(pureProfit)
    const avgRevenue = avg(data, 'revenue');
    const breakEvenRevenue = avgRevenue - avgProfitCut;

    const daysAbove = data.filter(r => r.revenue >= breakEvenRevenue).length;
    const daysBelow = data.filter(r => r.revenue < breakEvenRevenue).length;
    const pctAbove = data.length > 0 ? (daysAbove / data.length * 100) : 0;


    container.innerHTML = `
    <div class="breakeven-grid">
      <div class="breakeven-stat">
        <div class="breakeven-stat__label">Break-Even Revenue (Daily)</div>
        <div class="breakeven-stat__value">${formatCurrency(breakEvenRevenue)}</div>
        <div class="breakeven-stat__sub">Min daily revenue to avoid loss</div>
      </div>
      <div class="breakeven-stat">
        <div class="breakeven-stat__label">Avg Daily Expenses</div>
        <div class="breakeven-stat__value">${formatCurrency(avgDailyExpenses + avgManagerPayout)}</div>
        <div class="breakeven-stat__sub">Fuel + Supplies + Manager</div>
      </div>
      <div class="breakeven-stat">
        <div class="breakeven-stat__label">Days Above Break-Even</div>
        <div class="breakeven-stat__value cell-positive">${daysAbove} / ${data.length}</div>
        <div class="breakeven-stat__sub">${pctAbove.toFixed(0)}% of operating days</div>
      </div>
      <div class="breakeven-stat">
        <div class="breakeven-stat__label">Days Below Break-Even</div>
        <div class="breakeven-stat__value cell-negative">${daysBelow}</div>
        <div class="breakeven-stat__sub">${(100 - pctAbove).toFixed(0)}% of operating days</div>
      </div>
    </div>
  `;
}

// ===== MANAGER PAYOUT ANALYSIS =====
function renderManagerAnalysis() {
    const data = getFilteredData();
    const container = document.getElementById('managerPanel');
    if (data.length === 0) { container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem;">No data available</p>'; return; }

    const withPayout = data.filter(r => r.managerPayout > 0);
    const withoutPayout = data.filter(r => r.managerPayout === 0);

    const avgRevWith = avg(withPayout, 'revenue');
    const avgRevWithout = avg(withoutPayout, 'revenue');
    const avgProfitWith = avg(withPayout, 'pureProfit');
    const avgProfitWithout = avg(withoutPayout, 'pureProfit');
    const totalPayouts = sum(data, 'managerPayout');
    const avgPayout = withPayout.length > 0 ? sum(withPayout, 'managerPayout') / withPayout.length : 0;


    container.innerHTML = `
    <div class="manager-grid">
      <div class="manager-stat">
        <div class="manager-stat__label">Days with Payout</div>
        <div class="manager-stat__value">${withPayout.length} <span class="manager-stat__of">/ ${data.length}</span></div>
      </div>
      <div class="manager-stat">
        <div class="manager-stat__label">Total Payouts</div>
        <div class="manager-stat__value">${formatCurrency(totalPayouts)}</div>
      </div>
      <div class="manager-stat">
        <div class="manager-stat__label">Avg Payout Amount</div>
        <div class="manager-stat__value">${formatCurrency(avgPayout)}</div>
      </div>
      <div class="manager-stat">
        <div class="manager-stat__label">Avg Revenue (with payout)</div>
        <div class="manager-stat__value cell-highlight">${formatCurrency(avgRevWith)}</div>
      </div>
      <div class="manager-stat">
        <div class="manager-stat__label">Avg Revenue (no payout)</div>
        <div class="manager-stat__value">${formatCurrency(avgRevWithout)}</div>
      </div>
      <div class="manager-stat">
        <div class="manager-stat__label">Avg Profit (with payout)</div>
        <div class="manager-stat__value ${avgProfitWith >= 0 ? 'cell-positive' : 'cell-negative'}">${avgProfitWith < 0 ? '-' : ''}${formatCurrency(avgProfitWith)}</div>
      </div>
      <div class="manager-stat">
        <div class="manager-stat__label">Avg Profit (no payout)</div>
        <div class="manager-stat__value ${avgProfitWithout >= 0 ? 'cell-positive' : 'cell-negative'}">${avgProfitWithout < 0 ? '-' : ''}${formatCurrency(avgProfitWithout)}</div>
      </div>
    </div>
  `;
}

// ===== FUEL COST ANALYSIS =====
function renderFuelAnalysis() {
    const filterData = getFilteredData();
    const overallData = Object.values(allData).flat();
    const container = document.getElementById('fuelPanel');
    if (overallData.length === 0) { container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem;">No data available</p>'; return; }

    const monthlyFuel = filterData.reduce((s, r) => s + r.expensesParsed.fuel, 0);
    const overallFuel = overallData.reduce((s, r) => s + r.expensesParsed.fuel, 0);
    
    // Additional robust metrics for filtered month
    const totalExp = sum(filterData, 'totalExpenses') + sum(filterData, 'managerPayout');
    const fuelPctOfExp = totalExp > 0 ? (monthlyFuel / totalExp * 100).toFixed(1) + '%' : '0%';
    const avgDailyFuel = filterData.length > 0 ? formatCurrency(monthlyFuel / filterData.length) : formatCurrency(0);

    const monthLabel = activeMonth === 'all' ? 'All Months' : escapeHtml(activeMonth);

    container.innerHTML = `
    <div class="manager-grid">
      <div class="manager-stat">
        <div class="manager-stat__label">Selected Period (${monthLabel})</div>
        <div class="manager-stat__value cell-highlight">${formatCurrency(monthlyFuel)}</div>
      </div>
      <div class="manager-stat">
        <div class="manager-stat__label">Overall Fuel (All Time)</div>
        <div class="manager-stat__value">${formatCurrency(overallFuel)}</div>
      </div>
      <div class="manager-stat">
        <div class="manager-stat__label">Avg Daily Fuel Cost</div>
        <div class="manager-stat__value">${avgDailyFuel}</div>
      </div>
      <div class="manager-stat">
        <div class="manager-stat__label">Fuel % of Total Expenses</div>
        <div class="manager-stat__value">${fuelPctOfExp}</div>
      </div>
    </div>
  `;
}

// ===== WEEKLY SUMMARIES =====
function renderWeeklySummaries() {
    const data = [...getFilteredData()].sort((a, b) => a.date - b.date);
    if (data.length === 0) { document.getElementById('weeklyPanel').innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem;">No data available</p>'; return; }

    // Group by ISO week
    const weeks = {};
    data.forEach(r => {
        const d = r.date;
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() - d.getDay() + 1); // Monday
        const key = startOfWeek.toISOString().split('T')[0];
        if (!weeks[key]) weeks[key] = { start: startOfWeek, rows: [] };
        weeks[key].rows.push(r);
    });

    const weekKeys = Object.keys(weeks).sort();
    const container = document.getElementById('weeklyPanel');

    let html = '<div class="weekly-table-container"><table class="data-table weekly-table"><thead><tr>';
    html += '<th>Week</th><th>Days</th><th>Revenue</th><th>Expenses</th><th>Gross</th><th>Profit</th><th>Margin</th><th>Trend</th>';
    html += '</tr></thead><tbody>';

    let prevProfit = null;
    weekKeys.forEach(key => {
        const w = weeks[key];
        const endOfWeek = new Date(w.start);
        endOfWeek.setDate(w.start.getDate() + 6);
        const rev = sum(w.rows, 'revenue');
        const exp = sum(w.rows, 'totalExpenses') + sum(w.rows, 'managerPayout');
        const gross = sum(w.rows, 'totalGross');
        const profit = sum(w.rows, 'pureProfit');
        const margin = rev > 0 ? (profit / rev * 100) : 0;

        let trend = '→';
        let trendClass = 'neutral';
        if (prevProfit !== null) {
            if (profit > prevProfit) { trend = '↑'; trendClass = 'up'; }
            else if (profit < prevProfit) { trend = '↓'; trendClass = 'down'; }
        }
        prevProfit = profit;

        const label = `${w.start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} – ${endOfWeek.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`;

        html += `<tr>
      <td>${label}</td>
      <td>${w.rows.length}</td>
      <td class="cell-highlight">${formatCurrency(rev)}</td>
      <td>${formatCurrency(exp)}</td>
      <td>${formatCurrency(gross)}</td>
      <td class="${profit >= 0 ? 'cell-positive' : 'cell-negative'}">${profit < 0 ? '-' : ''}${formatCurrency(profit)}</td>
      <td>${margin.toFixed(1)}%</td>
      <td class="kpi-card__trend ${trendClass}">${trend}</td>
    </tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

// ===== CHARTS =====
function getChartColors() {
    return {
        blue: '#3b82f6', blueFaded: 'rgba(59, 130, 246, 0.15)',
        emerald: '#10b981', emeraldFaded: 'rgba(16, 185, 129, 0.15)',
        amber: '#f59e0b', amberFaded: 'rgba(245, 158, 11, 0.15)',
        rose: '#f43f5e', roseFaded: 'rgba(244, 63, 94, 0.15)',
        violet: '#8b5cf6', violetFaded: 'rgba(139, 92, 246, 0.15)',
        cyan: '#06b6d4', cyanFaded: 'rgba(6, 182, 212, 0.15)',
        pink: '#ec4899', pinkFaded: 'rgba(236, 72, 153, 0.15)',
        textMuted: '#64748b', gridLine: 'rgba(255,255,255,0.05)'
    };
}

function defaultScales(percentY) {
    const c = getChartColors();
    return {
        x: {
            ticks: { color: c.textMuted, font: { size: 10, family: 'Inter' }, maxRotation: 45 },
            grid: { display: false }
        },
        y: {
            ticks: {
                color: c.textMuted,
                font: { size: 10, family: 'Inter' },
                callback: percentY ? (v => v.toFixed(0) + '%') : (v => formatCurrencyShort(v))
            },
            grid: { color: c.gridLine }
        }
    };
}

function tooltipConfig() {
    return {
        backgroundColor: 'rgba(17,24,39,0.95)',
        titleColor: '#f1f5f9',
        bodyColor: '#94a3b8',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        padding: 12,
        bodyFont: { family: 'Inter' }
    };
}

// (chart rendering kicks off from renderAll or init)

// Revenue Trend — overlay per month
function renderRevenueChart() {
    const c = getChartColors();
    const colorPalette = [c.blue, c.emerald, c.violet, c.amber, c.rose, c.cyan, c.pink];
    const fadedPalette = [c.blueFaded, c.emeraldFaded, c.violetFaded, c.amberFaded, c.roseFaded, c.cyanFaded, c.pinkFaded];

    const maxDays = Math.max(...detectedSheets.map(s => (allData[s] || []).length), 1);
    const labels = Array.from({ length: maxDays }, (_, i) => `Day ${i + 1}`);

    const datasets = detectedSheets.map((name, i) => ({
        label: name,
        data: (allData[name] || []).map(r => r.revenue),
        borderColor: colorPalette[i % colorPalette.length],
        backgroundColor: fadedPalette[i % fadedPalette.length],
        fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2
    }));

    const ctx = document.getElementById('revenueChart').getContext('2d');
    if (charts.revenue) charts.revenue.destroy();
    charts.revenue = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: c.textMuted, font: { family: 'Inter', size: 11 }, usePointStyle: true, pointStyle: 'circle' } },
                tooltip: { ...tooltipConfig(), callbacks: { label: ctx2 => `${ctx2.dataset.label}: ${formatCurrency(ctx2.raw)}` } }
            },
            scales: defaultScales()
        }
    });
}

// Expense Donut
function renderExpenseDonut() {
    const c = getChartColors();
    const data = getFilteredData();
    let fuel = 0, oil = 0, charger = 0, tape = 0, marker = 0, other = 0, manager = 0;
    data.forEach(r => {
        fuel += r.expensesParsed.fuel; oil += r.expensesParsed.oil;
        charger += r.expensesParsed.charger; tape += r.expensesParsed.tape;
        marker += r.expensesParsed.marker; other += r.expensesParsed.other;
        manager += r.managerPayout;
    });
    const values = [fuel, oil, charger, tape, marker, other, manager];
    const labels = ['Fuel', 'Engine Oil', 'Charger', 'Tape', 'Marker', 'Other', 'Manager Payout'];
    const colors = [c.amber, c.rose, c.cyan, c.pink, c.violet, '#6b7280', c.blue];
    // Filter out zero categories
    const filtered = labels.map((l, i) => ({ label: l, value: values[i], color: colors[i] })).filter(x => x.value > 0);
    const total = filtered.reduce((s, x) => s + x.value, 0);

    const ctx = document.getElementById('expenseChart').getContext('2d');
    if (charts.expense) charts.expense.destroy();
    charts.expense = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: filtered.map(x => x.label),
            datasets: [{ data: filtered.map(x => x.value), backgroundColor: filtered.map(x => x.color), borderColor: 'rgba(10,14,26,0.8)', borderWidth: 3, hoverOffset: 8 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '65%',
            plugins: {
                legend: { position: 'right', labels: { color: c.textMuted, font: { family: 'Inter', size: 11 }, usePointStyle: true, pointStyle: 'circle', padding: 12 } },
                tooltip: { ...tooltipConfig(), callbacks: { label: ctx2 => ` ${ctx2.label}: ${formatCurrency(ctx2.raw)} (${(ctx2.raw / total * 100).toFixed(1)}%)` } }
            }
        }
    });
}

// Daily Profit bars
function renderProfitChart() {
    const c = getChartColors();
    const data = [...getFilteredData()].sort((a, b) => a.date - b.date);
    const labels = data.map(r => r.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
    const values = data.map(r => r.pureProfit);

    const ctx = document.getElementById('profitChart').getContext('2d');
    if (charts.profit) charts.profit.destroy();
    charts.profit = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Pure Profit', data: values,
                backgroundColor: values.map(v => v >= 0 ? c.emeraldFaded : c.roseFaded),
                borderColor: values.map(v => v >= 0 ? c.emerald : c.rose),
                borderWidth: 1.5, borderRadius: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { ...tooltipConfig(), callbacks: { label: ctx2 => `Profit: ${formatCurrency(ctx2.raw)}` } } },
            scales: defaultScales()
        }
    });
}

// Day-of-week performance
function renderDayOfWeekChart() {
    const c = getChartColors();
    const data = getFilteredData();
    const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayMap = {};
    dayOrder.forEach(d => dayMap[d] = { total: 0, count: 0 });
    data.forEach(r => {
        const key = dayOrder.find(day => r.day.trim().toLowerCase().startsWith(day.toLowerCase()));
        if (key) { dayMap[key].total += r.revenue; dayMap[key].count++; }
    });
    const avgRevByDay = dayOrder.map(d => dayMap[d].count ? dayMap[d].total / dayMap[d].count : 0);
    const gradient = [c.blue, c.blue, c.violet, c.violet, c.emerald, c.amber, c.amber];

    const ctx = document.getElementById('dayOfWeekChart').getContext('2d');
    if (charts.dayOfWeek) charts.dayOfWeek.destroy();
    charts.dayOfWeek = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dayOrder.map(d => d.substring(0, 3)),
            datasets: [{ label: 'Avg Revenue', data: avgRevByDay, backgroundColor: gradient.map(g => g + '33'), borderColor: gradient, borderWidth: 1.5, borderRadius: 6 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { ...tooltipConfig(), callbacks: { label: ctx2 => `Avg Revenue: ${formatCurrency(ctx2.raw)}` } } },
            scales: defaultScales()
        }
    });
}

// ===== NEW CHART: Profit Margin Over Time =====
function renderProfitMarginChart() {
    const c = getChartColors();
    const data = [...getFilteredData()].sort((a, b) => a.date - b.date);
    const labels = data.map(r => r.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
    const margins = data.map(r => r.revenue > 0 ? (r.pureProfit / r.revenue * 100) : 0);

    // 7-day moving average
    const ma = margins.map((_, i) => {
        const start = Math.max(0, i - 6);
        const slice = margins.slice(start, i + 1);
        return slice.reduce((s, v) => s + v, 0) / slice.length;
    });

    const ctx = document.getElementById('profitMarginChart').getContext('2d');
    if (charts.profitMargin) charts.profitMargin.destroy();
    charts.profitMargin = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Daily Margin %', data: margins,
                    borderColor: c.violet, backgroundColor: c.violetFaded,
                    fill: false, tension: 0.3, pointRadius: 2, borderWidth: 1.5
                },
                {
                    label: '7-Day Avg', data: ma,
                    borderColor: c.amber, borderDash: [6, 3],
                    fill: false, tension: 0.4, pointRadius: 0, borderWidth: 2.5
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: c.textMuted, font: { family: 'Inter', size: 11 }, usePointStyle: true } },
                tooltip: { ...tooltipConfig(), callbacks: { label: ctx2 => `${ctx2.dataset.label}: ${ctx2.raw.toFixed(1)}%` } }
            },
            scales: defaultScales(true)
        }
    });
}

// ===== NEW CHART: Expense Category Trends Over Time =====
function renderExpenseTrendChart() {
    const c = getChartColors();
    const data = getAllDataSorted();
    if (data.length === 0) return;

    // Group by week
    const weeks = {};
    data.forEach(r => {
        const d = r.date;
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() - d.getDay() + 1);
        const key = startOfWeek.toISOString().split('T')[0];
        if (!weeks[key]) weeks[key] = { start: startOfWeek, fuel: 0, oil: 0, charger: 0, tape: 0, other: 0 };
        weeks[key].fuel += r.expensesParsed.fuel;
        weeks[key].oil += r.expensesParsed.oil;
        weeks[key].charger += r.expensesParsed.charger;
        weeks[key].tape += r.expensesParsed.tape;
        weeks[key].other += r.expensesParsed.other + r.expensesParsed.marker;
    });

    const weekKeys = Object.keys(weeks).sort();
    const labels = weekKeys.map(k => {
        const d = weeks[k].start;
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    });

    const ctx = document.getElementById('expenseTrendChart').getContext('2d');
    if (charts.expenseTrend) charts.expenseTrend.destroy();
    charts.expenseTrend = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Fuel', data: weekKeys.map(k => weeks[k].fuel), backgroundColor: c.amberFaded, borderColor: c.amber, borderWidth: 1, borderRadius: 3 },
                { label: 'Engine Oil', data: weekKeys.map(k => weeks[k].oil), backgroundColor: c.roseFaded, borderColor: c.rose, borderWidth: 1, borderRadius: 3 },
                { label: 'Charger/Tape/Other', data: weekKeys.map(k => weeks[k].charger + weeks[k].tape + weeks[k].other), backgroundColor: c.violetFaded, borderColor: c.violet, borderWidth: 1, borderRadius: 3 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: c.textMuted, font: { family: 'Inter', size: 11 }, usePointStyle: true } },
                tooltip: { ...tooltipConfig(), callbacks: { label: ctx2 => `${ctx2.dataset.label}: ${formatCurrency(ctx2.raw)}` } }
            },
            scales: {
                ...defaultScales(),
                x: { ...defaultScales().x, stacked: true },
                y: { ...defaultScales().y, stacked: true }
            }
        }
    });
}

// ===== NEW CHART: Revenue Forecast =====
function renderForecastChart() {
    const c = getChartColors();
    const data = getAllDataSorted();
    if (data.length < 7) return;

    const revenues = data.map(r => r.revenue);
    const labels = data.map(r => r.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));

    // 7-day moving average
    const ma7 = revenues.map((_, i) => {
        const start = Math.max(0, i - 6);
        const slice = revenues.slice(start, i + 1);
        return slice.reduce((s, v) => s + v, 0) / slice.length;
    });

    // Project 14 days forward using linear regression on last 30 days
    const recentDays = Math.min(30, revenues.length);
    const recentRevs = revenues.slice(-recentDays);
    const n = recentRevs.length;
    const xMean = (n - 1) / 2;
    const yMean = recentRevs.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
        num += (i - xMean) * (recentRevs[i] - yMean);
        den += (i - xMean) * (i - xMean);
    }
    const slope = den !== 0 ? num / den : 0;
    const intercept = yMean - slope * xMean;

    // Generate forecast
    const forecastDays = 14;
    const forecastLabels = [];
    const forecastValues = [];
    const lastDate = data[data.length - 1].date;
    for (let i = 1; i <= forecastDays; i++) {
        const d = new Date(lastDate);
        d.setDate(lastDate.getDate() + i);
        forecastLabels.push(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
        forecastValues.push(Math.max(0, intercept + slope * (n - 1 + i)));
    }

    const allLabels = [...labels, ...forecastLabels];
    const actualPadded = [...revenues, ...Array(forecastDays).fill(null)];
    const maPadded = [...ma7, ...Array(forecastDays).fill(null)];
    const forecastPadded = [...Array(revenues.length - 1).fill(null), revenues[revenues.length - 1], ...forecastValues];

    const ctx = document.getElementById('forecastChart').getContext('2d');
    if (charts.forecast) charts.forecast.destroy();
    charts.forecast = new Chart(ctx, {
        type: 'line',
        data: {
            labels: allLabels,
            datasets: [
                {
                    label: 'Actual Revenue', data: actualPadded,
                    borderColor: c.blue, backgroundColor: c.blueFaded,
                    fill: false, tension: 0.3, pointRadius: 2, borderWidth: 2
                },
                {
                    label: '7-Day Moving Avg', data: maPadded,
                    borderColor: c.emerald, borderDash: [6, 3],
                    fill: false, tension: 0.4, pointRadius: 0, borderWidth: 2
                },
                {
                    label: 'Forecast (14 days)', data: forecastPadded,
                    borderColor: c.amber, backgroundColor: c.amberFaded,
                    borderDash: [4, 4], fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: c.textMuted, font: { family: 'Inter', size: 11 }, usePointStyle: true } },
                tooltip: { ...tooltipConfig(), callbacks: { label: ctx2 => ctx2.raw !== null ? `${ctx2.dataset.label}: ${formatCurrency(ctx2.raw)}` : '' } }
            },
            scales: defaultScales()
        }
    });
}

// ===== NEW CHART: Monthly Fuel Comparison =====
function renderFuelCostChart() {
    const c = getChartColors();
    if (detectedSheets.length === 0) return;

    // Group total fuel cost by each month
    const labels = detectedSheets.slice().reverse(); // Optional: order earliest to latest if detectedSheets is latest first
    const dataValues = labels.map(month => {
       const mData = allData[month] || [];
       return mData.reduce((s, r) => s + r.expensesParsed.fuel, 0);
    });

    const ctx = document.getElementById('fuelCostChart').getContext('2d');
    if (charts.fuelCost) charts.fuelCost.destroy();
    charts.fuelCost = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Total Fuel Cost', data: dataValues,
                backgroundColor: c.amberFaded, borderColor: c.amber,
                borderWidth: 1.5, borderRadius: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { ...tooltipConfig(), callbacks: { label: ctx2 => `Fuel Cost: ${formatCurrency(ctx2.raw)}` } }
            },
            scales: defaultScales()
        }
    });
}

// ===== DATA TABLE with Running Totals =====
let tableVisible = false;

function renderTable() {
    const data = [...getFilteredData()].sort((a, b) => sortAsc ? a.date - b.date : b.date - a.date);

    const columns = [
        { label: 'Date', key: 'date' },
        { label: 'Day', key: 'day' },
        { label: 'Revenue', key: 'revenue' },
        { label: 'Mgr Payout', key: 'managerPayout' },
        { label: 'Expenses', key: 'expensesRaw' },
        { label: 'Deposited', key: 'deposited' },
        { label: 'Gross', key: 'totalGross' },
        { label: 'Profit', key: 'pureProfit' },
        { label: 'Cum. Revenue', key: 'cumRevenue' },
        { label: 'Cum. Profit', key: 'cumProfit' }
    ];

    const thead = document.getElementById('tableHead');
    thead.innerHTML = `<tr>${columns.map((col, i) => {
        const sorted = i === sortColumn;
        const arrow = sorted ? (sortAsc ? '↑' : '↓') : '↕';
        return `<th class="${sorted ? 'sorted' : ''}" onclick="handleSort(${i})">${col.label} <span class="sort-arrow">${arrow}</span></th>`;
    }).join('')}</tr>`;

    // Calculate running totals
    let cumRevenue = 0, cumProfit = 0;
    const rowsWithCum = data.map(row => {
        cumRevenue += row.revenue;
        cumProfit += row.pureProfit;
        return { ...row, cumRevenue, cumProfit };
    });

    const tbody = document.getElementById('tableBody');
    const rows = rowsWithCum.map(row => {
        const profitClass = row.pureProfit > 0 ? 'cell-positive' : row.pureProfit < 0 ? 'cell-negative' : '';
        const cumProfitClass = row.cumProfit > 0 ? 'cell-positive' : row.cumProfit < 0 ? 'cell-negative' : '';
        return `<tr>
      <td>${row.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
      <td>${escapeHtml(row.day)}</td>
      <td class="cell-highlight">${formatCurrency(row.revenue)}</td>
      <td>${row.managerPayout ? formatCurrency(row.managerPayout) : '—'}</td>
      <td>${escapeHtml(row.expensesRaw) || '—'}</td>
      <td>${formatCurrency(row.deposited)}</td>
      <td>${formatCurrency(row.totalGross)}</td>
      <td class="${profitClass}">${row.pureProfit < 0 ? '-' : ''}${formatCurrency(row.pureProfit)}</td>
      <td class="cell-highlight">${formatCurrency(row.cumRevenue)}</td>
      <td class="${cumProfitClass}">${row.cumProfit < 0 ? '-' : ''}${formatCurrency(row.cumProfit)}</td>
    </tr>`;
    });

    // Totals
    const totals = {
        revenue: sum(data, 'revenue'), managerPayout: sum(data, 'managerPayout'),
        totalExpenses: sum(data, 'totalExpenses'), deposited: sum(data, 'deposited'),
        totalGross: sum(data, 'totalGross'), pureProfit: sum(data, 'pureProfit')
    };

    rows.push(`<tr class="total-row">
    <td colspan="2"><strong>TOTALS (${data.length} days)</strong></td>
    <td class="cell-highlight">${formatCurrency(totals.revenue)}</td>
    <td>${formatCurrency(totals.managerPayout)}</td>
    <td>${formatCurrency(totals.totalExpenses)}</td>
    <td>${formatCurrency(totals.deposited)}</td>
    <td>${formatCurrency(totals.totalGross)}</td>
    <td class="${totals.pureProfit >= 0 ? 'cell-positive' : 'cell-negative'}">${formatCurrency(totals.pureProfit)}</td>
    <td></td><td></td>
  </tr>`);

    tbody.innerHTML = rows.join('');
}

function handleSort(columnIndex) {
    if (sortColumn === columnIndex) { sortAsc = !sortAsc; }
    else { sortColumn = columnIndex; sortAsc = true; }
    renderTable();
}

// ===== RECORDS DROPDOWN HANDLERS =====
function handleMonthDropdown(monthName) {
    const dayGroup = document.getElementById('dayDropdownGroup');
    const dayDropdown = document.getElementById('dayDropdown');
    const recordDetail = document.getElementById('recordDetail');
    const monthSummary = document.getElementById('monthSummary');

    recordDetail.style.display = 'none';

    if (!monthName) {
        dayGroup.style.display = 'none';
        monthSummary.style.display = 'none';
        return;
    }

    // Populate day dropdown with days from this month
    const monthData = allData[monthName] || [];
    let opts = `<option value="">— Select Day —</option>`;
    const sorted = [...monthData].sort((a, b) => a.date - b.date);
    sorted.forEach((row, i) => {
        const dateLabel = row.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        opts += `<option value="${i}">${dateLabel} (${escapeHtml(row.day.trim())}) — Rev: ${formatCurrency(row.revenue)}</option>`;
    });
    dayDropdown.innerHTML = opts;
    dayGroup.style.display = 'flex';

    // Show month summary
    renderMonthSummary(monthName, sorted);
}

function handleDayDropdown(dayIndex) {
    const recordDetail = document.getElementById('recordDetail');
    const monthSummary = document.getElementById('monthSummary');
    const monthName = document.getElementById('monthDropdown').value;

    if (dayIndex === '' || !monthName) {
        recordDetail.style.display = 'none';
        monthSummary.style.display = 'block';
        return;
    }

    monthSummary.style.display = 'none';
    const monthData = [...(allData[monthName] || [])].sort((a, b) => a.date - b.date);
    const row = monthData[parseInt(dayIndex)];
    if (!row) return;

    renderRecordDetail(row, monthData, parseInt(dayIndex));
}

function renderRecordDetail(row, monthData, dayIndex) {
    const container = document.getElementById('recordDetail');
    const margin = row.revenue > 0 ? (row.pureProfit / row.revenue * 100) : 0;
    const profitClass = row.pureProfit >= 0 ? 'cell-positive' : 'cell-negative';
    const marginClass = margin >= 5 ? 'cell-positive' : margin >= 0 ? 'cell-highlight' : 'cell-negative';

    // Running total up to this day
    let cumRev = 0, cumProfit = 0;
    for (let i = 0; i <= dayIndex; i++) {
        cumRev += monthData[i].revenue;
        cumProfit += monthData[i].pureProfit;
    }

    // Expense breakdown
    const exp = row.expensesParsed;
    let expenseBreakdown = '';
    if (exp.total > 0) {
        const items = [];
        if (exp.fuel) items.push(`<span class="exp-tag exp-tag--fuel">⛽ Fuel: ${formatCurrency(exp.fuel)}</span>`);
        if (exp.oil) items.push(`<span class="exp-tag exp-tag--oil">🛢️ Oil: ${formatCurrency(exp.oil)}</span>`);
        if (exp.charger) items.push(`<span class="exp-tag exp-tag--charger">🔌 Charger: ${formatCurrency(exp.charger)}</span>`);
        if (exp.tape) items.push(`<span class="exp-tag exp-tag--other">📦 Tape: ${formatCurrency(exp.tape)}</span>`);
        if (exp.marker) items.push(`<span class="exp-tag exp-tag--other">✏️ Marker: ${formatCurrency(exp.marker)}</span>`);
        if (exp.other) items.push(`<span class="exp-tag exp-tag--other">📋 Other: ${formatCurrency(exp.other)}</span>`);
        expenseBreakdown = `<div class="detail-expenses">${items.join('')}</div>`;
    }

    container.innerHTML = `
      <div class="record-detail__card animate-in">
        <div class="detail-header">
          <div class="detail-date">
            <div class="detail-date__day">${row.date.toLocaleDateString('en-GB', { weekday: 'long' })}</div>
            <div class="detail-date__full">${row.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
          </div>
          <div class="detail-profit ${profitClass}">
            <div class="detail-profit__label">Pure Profit</div>
            <div class="detail-profit__value">${row.pureProfit < 0 ? '-' : ''}${formatCurrency(row.pureProfit)}</div>
          </div>
        </div>

        <div class="detail-metrics">
          <div class="detail-metric">
            <div class="detail-metric__icon">💰</div>
            <div class="detail-metric__label">Revenue</div>
            <div class="detail-metric__value cell-highlight">${formatCurrency(row.revenue)}</div>
          </div>
          <div class="detail-metric">
            <div class="detail-metric__icon">👤</div>
            <div class="detail-metric__label">Manager Payout</div>
            <div class="detail-metric__value">${row.managerPayout ? formatCurrency(row.managerPayout) : '—'}</div>
          </div>
          <div class="detail-metric">
            <div class="detail-metric__icon">📊</div>
            <div class="detail-metric__label">Total Expenses</div>
            <div class="detail-metric__value">${formatCurrency(row.totalExpenses)}</div>
          </div>
          <div class="detail-metric">
            <div class="detail-metric__icon">💳</div>
            <div class="detail-metric__label">Deposited</div>
            <div class="detail-metric__value">${formatCurrency(row.deposited)}</div>
          </div>
          <div class="detail-metric">
            <div class="detail-metric__icon">📈</div>
            <div class="detail-metric__label">Total Gross</div>
            <div class="detail-metric__value">${formatCurrency(row.totalGross)}</div>
          </div>
          <div class="detail-metric">
            <div class="detail-metric__icon">📐</div>
            <div class="detail-metric__label">Profit Margin</div>
            <div class="detail-metric__value ${marginClass}">${margin.toFixed(1)}%</div>
          </div>
        </div>

        ${expenseBreakdown}

        <div class="detail-running">
          <div class="detail-running__item">
            <span class="detail-running__label">Running Revenue (Day ${dayIndex + 1})</span>
            <span class="detail-running__value cell-highlight">${formatCurrency(cumRev)}</span>
          </div>
          <div class="detail-running__item">
            <span class="detail-running__label">Running Profit (Day ${dayIndex + 1})</span>
            <span class="detail-running__value ${cumProfit >= 0 ? 'cell-positive' : 'cell-negative'}">${cumProfit < 0 ? '-' : ''}${formatCurrency(cumProfit)}</span>
          </div>
        </div>
      </div>
    `;
    container.style.display = 'block';
}

function renderMonthSummary(monthName, sortedData) {
    const container = document.getElementById('monthSummary');
    if (sortedData.length === 0) {
        container.style.display = 'none';
        return;
    }

    const rev = sum(sortedData, 'revenue');
    const exp = sum(sortedData, 'totalExpenses') + sum(sortedData, 'managerPayout');
    const gross = sum(sortedData, 'totalGross');
    const profit = sum(sortedData, 'pureProfit');
    const margin = rev > 0 ? (profit / rev * 100) : 0;
    const bestDay = [...sortedData].sort((a, b) => b.pureProfit - a.pureProfit)[0];
    const worstDay = [...sortedData].sort((a, b) => a.pureProfit - b.pureProfit)[0];

    container.innerHTML = `
      <div class="month-summary__card animate-in">
        <div class="month-summary__title">${monthName} — ${sortedData.length} Days</div>
        <div class="month-summary__grid">
          <div class="month-summary__stat">
            <div class="month-summary__stat-label">Total Revenue</div>
            <div class="month-summary__stat-value cell-highlight">${formatCurrency(rev)}</div>
          </div>
          <div class="month-summary__stat">
            <div class="month-summary__stat-label">Total Expenses</div>
            <div class="month-summary__stat-value">${formatCurrency(exp)}</div>
          </div>
          <div class="month-summary__stat">
            <div class="month-summary__stat-label">Total Gross</div>
            <div class="month-summary__stat-value">${formatCurrency(gross)}</div>
          </div>
          <div class="month-summary__stat">
            <div class="month-summary__stat-label">Pure Profits</div>
            <div class="month-summary__stat-value ${profit >= 0 ? 'cell-positive' : 'cell-negative'}">${profit < 0 ? '-' : ''}${formatCurrency(profit)}</div>
          </div>
          <div class="month-summary__stat">
            <div class="month-summary__stat-label">Profit Margin</div>
            <div class="month-summary__stat-value">${margin.toFixed(1)}%</div>
          </div>
          <div class="month-summary__stat">
            <div class="month-summary__stat-label">Best Day</div>
            <div class="month-summary__stat-value cell-positive">${bestDay.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} (${formatCurrency(bestDay.pureProfit)})</div>
          </div>
        </div>
        <div class="month-summary__hint">👆 Select a day above to view full details</div>
      </div>
    `;
    container.style.display = 'block';
}

function toggleFullTable() {
    tableVisible = !tableVisible;
    const wrap = document.getElementById('fullTableWrap');
    const icon = document.getElementById('toggleTableIcon');
    const btn = document.getElementById('toggleTableBtn');

    if (tableVisible) {
        renderTable();
        wrap.style.display = 'block';
        icon.textContent = '▲';
        btn.innerHTML = `<span id="toggleTableIcon">▲</span> Hide All Records`;
    } else {
        wrap.style.display = 'none';
        icon.textContent = '▼';
        btn.innerHTML = `<span id="toggleTableIcon">▼</span> Show All Records`;
    }
}

// ===== MONTH FILTER =====
function setActiveMonth(month) {
    activeMonth = month;
    document.querySelectorAll('.month-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.month === month));
    renderAll();
}

function renderAll() {
    renderKPIs();
    renderAlerts();
    renderBreakEven();
    renderManagerAnalysis();
    renderFuelAnalysis();
    renderWeeklySummaries();

    // Wrap each chart in try/catch so one failure doesn't crash the dashboard
    const chartRenders = [
        renderExpenseDonut,
        renderProfitChart,
        renderDayOfWeekChart,
        renderProfitMarginChart,
        renderExpenseTrendChart,
        renderForecastChart,
        renderFuelCostChart
    ];
    for (const fn of chartRenders) {
        try { fn(); } catch (e) { console.error(`Chart render error in ${fn.name}:`, e); }
    }

    // Only render table when visible (performance)
    if (tableVisible) renderTable();
}

// ===== WEATHER FORECAST & FUEL RISK =====
async function fetchWeatherAndRender() {
    const container = document.getElementById('weatherPanel');
    if (!container) return;
    
    // Iraye-Oke, Epe, Lagos Coordinates
    const lat = 6.58;
    const lon = 3.98;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Africa%2FLagos`;
    
    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('Weather fetch failed');
        const data = await resp.json();
        
        const daily = data.daily;
        if (!daily || !daily.time) throw new Error('Invalid weather data');
        
        let html = '<div class="weather-grid">';
        
        for (let i = 0; i < daily.time.length; i++) {
            const dateStr = daily.time[i];
            const dateObj = new Date(dateStr);
            const dayName = dateObj.toLocaleDateString('en-GB', { weekday: 'short' });
            const shortDate = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            
            const maxTemp = Math.round(daily.temperature_2m_max[i]);
            const precip = daily.precipitation_sum[i];
            const code = daily.weathercode[i];
            
            // Map WMO Weather codes to emoji
            let icon = '☀️';
            if (code >= 1 && code <= 3) icon = '⛅';
            else if (code >= 45 && code <= 48) icon = '🌫️';
            else if (code >= 51 && code <= 67) icon = '🌧️';
            else if (code >= 71 && code <= 77) icon = '❄️';
            else if (code >= 80 && code <= 82) icon = '🌦️';
            else if (code >= 95) icon = '⛈️';
            
            const isHighRisk = precip > 2; // > 2mm means significant rain
            
            html += `
              <div class="weather-card ${isHighRisk ? 'weather-card--risk' : 'weather-card--safe'}">
                <div class="weather-card__header">
                  <span class="weather-card__day">${dayName}</span>
                  <span class="weather-card__date">${shortDate}</span>
                </div>
                <div class="weather-card__body">
                  <div class="weather-card__icon-wrapper">
                    <span class="weather-card__icon">${icon}</span>
                  </div>
                  <div class="weather-card__temp">${maxTemp}°</div>
                  <div class="weather-card__precip">
                    <span class="precip-icon">💧</span> ${precip > 0 ? precip + 'mm' : '0mm'}
                  </div>
                </div>
                <div class="weather-card__footer">
                  <span class="weather-card__badge ${isHighRisk ? 'badge--danger' : 'badge--success'}">
                    ${isHighRisk ? '⚠️ High Risk' : '✨ Optimal'}
                  </span>
                </div>
              </div>
            `;
        }
        
        html += '</div>';
        container.innerHTML = html;
        
    } catch (err) {
        console.error('Weather Error:', err);
        container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem;">Could not load weather forecast.</p>';
    }
}


// ===== INITIALIZATION =====
async function init() {
    const loader = document.getElementById('loadingOverlay');
    const errorBanner = document.getElementById('errorBanner');

    try {
        // Auto-detect sheets
        detectedSheets = await discoverSheets();
        if (detectedSheets.length === 0) throw new Error('No sheet tabs found. Make sure the spreadsheet is publicly shared.');

        // Render dynamic month buttons
        renderMonthButtons();

        // Fetch data
        allData = await fetchAllData();
        const totalRows = Object.values(allData).reduce((s, arr) => s + arr.length, 0);
        if (totalRows === 0) throw new Error('No data returned from the spreadsheet.');

        // Render everything
        renderAll();
        renderRevenueChart(); // always show all months overlay
        fetchWeatherAndRender(); // Fetch weather data independent of sheets
        updateTimestamp();

        loader.classList.add('fade-out');
        setTimeout(() => loader.style.display = 'none', 500);

    } catch (err) {
        console.error('Init error:', err);
        loader.style.display = 'none';
        errorBanner.textContent = `⚠️ Failed to load data: ${err.message}`;
        errorBanner.classList.add('visible');
    }

    // Auto-refresh
    setInterval(async () => {
        try {
            allData = await fetchAllData();
            renderAll();
            renderRevenueChart();
            updateTimestamp();
        } catch (e) { console.error('Refresh error:', e); }
    }, REFRESH_INTERVAL);
}

function updateTimestamp() {
    const el = document.getElementById('lastUpdated');
    if (el) el.textContent = `Last updated: ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

async function handleRefresh() {
    const btn = document.getElementById('refreshBtn');
    btn.classList.add('loading');
    try {
        detectedSheets = await discoverSheets();
        renderMonthButtons();
        allData = await fetchAllData();
        setActiveMonth(activeMonth);
        updateTimestamp();
    } catch (e) { console.error('Refresh error:', e); }
    finally { btn.classList.remove('loading'); }
}

document.addEventListener('DOMContentLoaded', init);
