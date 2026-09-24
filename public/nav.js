/* nav.js — sidebar + header injection for authenticated pages */
(async function () {
  'use strict';

  let user = null;
  try {
    const r = await fetch('/api/auth/me');
    if (!r.ok) { window.location.href = '/'; return; }
    const d = await r.json();
    if (!d.success || !d.user) { window.location.href = '/'; return; }
    user = d.user;
  } catch {
    window.location.href = '/';
    return;
  }

  const role = user.role;
  const mgtLevel = Number(user.managementLevel) || 0;
  const isAdmin = role === 'admin';
  const isMgt   = role === 'management';
  const isL1    = isMgt && mgtLevel === 1;
  const isAcct  = role === 'accountant';
  const isSup   = role === 'supervisor';
  const isAdminOrL1 = isAdmin || isL1;

  function can(...roles) { return roles.includes(role); }

  // ── Nav structure ─────────────────────────────────────────────
  const NAV = [
    { section: 'Main' },
    { label: 'Dashboard',      href: '/dashboard',    icon: 'dashboard',   show: true },
    { label: 'Employees',      href: '/employees',    icon: 'employees',   show: !isSup },
    { label: 'Payroll',        href: '/payroll',      icon: 'payroll',     show: !isSup },
    { label: 'Payroll Status', href: '/payroll-status', icon: 'status',    show: !isSup },
    { label: 'Payslip',        href: '/payslip',      icon: 'payslip',     show: true },
    { label: 'Attendance',     href: '/attendance',   icon: 'attendance',  show: true },
    { section: 'HR & Finance' },
    { label: 'Exits',          href: '/exits',        icon: 'exits',       show: !isAcct && !isSup },
    { label: 'Loans',          href: '/loans',        icon: 'loans',       show: !isSup },
    { label: 'Adjustments',    href: '/adjustments',  icon: 'adjustments', show: !isSup },
    { label: 'OT',             href: '/ot',           icon: 'ot',          show: !isSup },
    { label: 'Arrears',        href: '/arrears',      icon: 'arrears',     show: !isSup },
    { label: 'TDS',            href: '/tds',          icon: 'tds',         show: !isSup },
    { label: 'Extra Pay',      href: '/extra-pay',    icon: 'extrapay',    show: !isSup },
    { label: 'Appraisals',     href: '/appraisals',   icon: 'appraisals',  show: !isSup },
    { label: 'Reports',        href: '/reports',      icon: 'reports',     show: !isSup },
    { section: 'Administration' },
    { label: 'Submissions',    href: '/submissions',  icon: 'submissions', show: isAdmin || isMgt },
    { label: 'Masters',        href: '/masters',      icon: 'masters',     show: isAdmin || isMgt },
    { label: 'School Info',    href: '/school-info',  icon: 'school',      show: isAdmin || isMgt },
    { label: 'Bank Details',   href: '/bank-details', icon: 'bank',        show: isAdmin || isMgt },
    { label: 'Supervisor Map', href: '/supervisor-mapping', icon: 'supervisor', show: isAdmin || isMgt },
    { label: 'ID Cards',       href: '/id-cards',     icon: 'idcard',      show: isAdmin || isMgt },
    { label: 'Photo Task',     href: '/photo-task',   icon: 'photo',       show: isAdmin || isMgt },
    { label: 'Audit Log',      href: '/audit-log',    icon: 'audit',       show: isAdminOrL1 },
    { label: 'Settings',       href: '/settings',     icon: 'settings',    show: isAdminOrL1 },
    { label: 'Users',          href: '/users',        icon: 'users',       show: isAdmin },
  ];

  const currentPath = window.location.pathname.replace(/\/$/, '') || '/';

  function svgUse(id, size) {
    size = size || 16;
    return `<svg width="${size}" height="${size}" aria-hidden="true"><use href="/icons.svg#icon-${id}"/></svg>`;
  }

  function initials(name) {
    if (!name) return '?';
    return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  }

  // ── Sidebar HTML ──────────────────────────────────────────────
  let sidebarHtml = '<nav class="sidebar-nav">';
  let lastWasSection = false;
  for (const item of NAV) {
    if (!item.show && !item.section) continue;
    if (item.section) {
      sidebarHtml += `<div class="nav-section-label">${item.section}</div>`;
      lastWasSection = true;
    } else if (item.show) {
      const isActive = currentPath === item.href || currentPath.startsWith(item.href + '/');
      sidebarHtml += `<a href="${item.href}" class="nav-item${isActive ? ' active' : ''}">
        ${svgUse(item.icon, 16)}
        <span class="nav-item-label">${item.label}</span>
      </a>`;
      lastWasSection = false;
    }
  }
  sidebarHtml += '</nav>';

  // ── Header HTML ───────────────────────────────────────────────
  const roleLabel = {
    admin: 'System Admin',
    management: 'Management' + (user.managementLevel ? ' L' + mgtLevel : ''),
    accountant: 'Accountant',
    supervisor: 'Supervisor',
  }[role] || role;

  const headerHtml = `
<header class="app-header">
  <div class="app-header-left">
    <a class="app-header-logo" href="/dashboard">
      ${svgUse('building', 20)}
      <span class="app-header-logo-text">Payroll</span>
    </a>
    <button class="sidebar-toggle" id="sidebarToggle" title="Toggle sidebar" aria-label="Toggle sidebar">
      ${svgUse('menu', 18)}
    </button>
  </div>
  <div class="app-header-right">
    <div class="user-chip">
      <div class="user-avatar">${initials(user.fullName)}</div>
      <span class="user-name">${user.fullName || user.username} <span style="font-weight:400;color:var(--text-muted);">(${roleLabel})</span></span>
    </div>
    <button class="btn-logout" id="logoutBtn">Logout</button>
  </div>
</header>
<aside class="app-sidebar" id="appSidebar">${sidebarHtml}</aside>
`;

  // ── Inject ─────────────────────────────────────────────────────
  document.body.classList.add('app-body');
  document.body.insertAdjacentHTML('afterbegin', headerHtml);

  // Hide old inline headers
  document.querySelectorAll('.header, header:not(.app-header)').forEach(el => {
    el.style.display = 'none';
  });

  // ── Toggle sidebar ────────────────────────────────────────────
  const toggle = document.getElementById('sidebarToggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      document.body.classList.toggle('sidebar-collapsed');
    });
  }

  // ── Logout ────────────────────────────────────────────────────
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
      window.location.href = '/';
    });
  }

  // ── Mobile overlay close ──────────────────────────────────────
  document.addEventListener('click', e => {
    if (window.innerWidth <= 768) {
      const sidebar = document.getElementById('appSidebar');
      const toggle2 = document.getElementById('sidebarToggle');
      if (sidebar && !sidebar.contains(e.target) && e.target !== toggle2 && !toggle2.contains(e.target)) {
        document.body.classList.remove('sidebar-open');
      }
    }
  });
})();
