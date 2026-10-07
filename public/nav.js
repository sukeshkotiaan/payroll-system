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

  // ── Fetch Masters permissions for non-admin roles ─────────────
  let allowedKeys = null; // null = no Masters filter (admin)
  if (!isAdmin) {
    try {
      const res = await fetch('/api/masters/role');
      const data = await res.json();
      if (data.success) {
        const roleData = data.masters.find(m => m.value.toLowerCase() === role.toLowerCase());
        allowedKeys = roleData ? (roleData.permissions || []) : [];
      }
    } catch (e) {
      allowedKeys = null; // on error fall back to role-only logic
    }
  }

  function isAllowed(item) {
    if (!item.show) return false;
    if (allowedKeys === null || !item.permKey) return true;
    return allowedKeys.includes(item.permKey);
  }

  // ── Nav structure ─────────────────────────────────────────────
  const NAV = [
    { section: 'Main' },
    { label: 'Dashboard',      href: '/dashboard',          icon: 'dashboard',   show: true,                       permKey: 'dashboard' },
    { label: 'Employees',      href: '/employees',          icon: 'employees',   show: !isSup,                     permKey: 'employees' },
    { label: 'Payroll',        href: '/payroll',            icon: 'payroll',     show: !isSup,                     permKey: 'payroll' },
    { label: 'Payroll Status', href: '/payroll-status',     icon: 'status',      show: !isSup,                     permKey: 'payroll' },
    { label: 'Payslip',        href: '/payslip',            icon: 'payslip',     show: true,                       permKey: 'payslip' },
    { label: 'Attendance',     href: '/attendance',         icon: 'attendance',  show: true,                       permKey: 'attendance' },
    { section: 'HR & Finance' },
    { label: 'Exits',          href: '/exits',              icon: 'exits',       show: !isAcct && !isSup,          permKey: 'exits' },
    { label: 'Loans',          href: '/loans',              icon: 'loans',       show: !isSup,                     permKey: 'loans' },
    { label: 'Adjustments',    href: '/adjustments',        icon: 'adjustments', show: !isSup,                     permKey: 'adjustments' },
    { label: 'OT',             href: '/ot',                 icon: 'ot',          show: !isSup,                     permKey: 'ot' },
    { label: 'Arrears',        href: '/arrears',            icon: 'arrears',     show: !isSup,                     permKey: 'arrears' },
    { label: 'TDS',            href: '/tds',                icon: 'tds',         show: !isSup,                     permKey: 'tds' },
    { label: 'Extra Pay',      href: '/extra-pay',          icon: 'extrapay',    show: !isSup,                     permKey: 'extra-pay' },
    { label: 'Appraisals',     href: '/appraisals',         icon: 'appraisals',  show: !isSup,                     permKey: 'appraisals' },
    { label: 'Reports',        href: '/reports',            icon: 'reports',     show: !isSup,                     permKey: 'reports' },
    { section: 'Administration' },
    { label: 'Submissions',    href: '/submissions',        icon: 'submissions', show: isAdmin || isMgt,           permKey: 'submissions' },
    { label: 'Masters',        href: '/masters',            icon: 'masters',     show: isAdmin || isMgt,           permKey: 'masters' },
    { label: 'School Info',    href: '/school-info',        icon: 'school',      show: isAdmin || isMgt,           permKey: 'school-info' },
    { label: 'Bank Details',   href: '/bank-details',       icon: 'bank',        show: isAdmin || isMgt,           permKey: 'bank-details' },
    { label: 'Supervisor Map', href: '/supervisor-mapping', icon: 'supervisor',  show: isAdmin || isMgt || isAcct, permKey: 'supervisor-mapping' },
    { label: 'ID Cards',       href: '/id-cards',           icon: 'idcard',      show: isAdmin || isMgt,           permKey: 'id-cards' },
    { label: 'Photo Task',     href: '/photo-task',         icon: 'photo',       show: isAdmin || isMgt,           permKey: 'photo-task' },
    { label: 'Audit Log',      href: '/audit-log',          icon: 'audit',       show: isAdminOrL1 },
    { label: 'Settings',       href: '/settings',           icon: 'settings',    show: isAdminOrL1,                permKey: 'settings' },
    { label: 'Users',          href: '/users',              icon: 'users',       show: isAdmin || isAcct,          permKey: 'users' },
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
  // Build allowed items first so we can skip empty sections
  const visibleItems = NAV.map(item => ({
    ...item,
    visible: item.section ? false : isAllowed(item)
  }));

  let sidebarHtml = '<nav class="sidebar-nav">';
  for (let i = 0; i < visibleItems.length; i++) {
    const item = visibleItems[i];
    if (item.section) {
      // Only render section label if at least one following item is visible
      const hasVisible = visibleItems.slice(i + 1).some(n => !n.section && n.visible);
      if (hasVisible) {
        sidebarHtml += `<div class="nav-section-label">${item.section}</div>`;
      }
    } else if (item.visible) {
      const isActive = currentPath === item.href || currentPath.startsWith(item.href + '/');
      sidebarHtml += `<a href="${item.href}" class="nav-item${isActive ? ' active' : ''}">
        ${svgUse(item.icon, 16)}
        <span class="nav-item-label">${item.label}</span>
      </a>`;
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
