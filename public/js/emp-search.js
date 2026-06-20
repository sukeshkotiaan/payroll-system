function attachEINSearch(inputId, onSelect, includeInactive) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const dropdown = document.createElement('div');
  dropdown.style.cssText = 'position:absolute;background:white;border:1px solid #ddd;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.15);z-index:99999;width:350px;max-height:300px;overflow-y:auto;display:none;left:0;top:100%;margin-top:2px;';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;display:inline-block;';
  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);
  wrapper.appendChild(dropdown);

  let debounceTimer;

  input.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 2) { dropdown.style.display = 'none'; return; }
    debounceTimer = setTimeout(function() { fetchSuggestions(q); }, 250);
  });

  input.addEventListener('keydown', function(e) {
    const items = dropdown.querySelectorAll('.emp-item');
    const active = dropdown.querySelector('.emp-item.active');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!active && items[0]) items[0].classList.add('active');
      else if (active && active.nextElementSibling) { active.classList.remove('active'); active.nextElementSibling.classList.add('active'); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (active && active.previousElementSibling) { active.classList.remove('active'); active.previousElementSibling.classList.add('active'); }
    } else if (e.key === 'Enter') {
      const activeItem = dropdown.querySelector('.emp-item.active');
      if (activeItem) { e.preventDefault(); activeItem.click(); }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
    }
  });

  async function fetchSuggestions(q) {
    try {
      let url = '/api/employees/search?q=' + encodeURIComponent(q);
      if (includeInactive) url += '&includeInactive=true';
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();
      if (!data.success || !data.employees.length) { dropdown.style.display = 'none'; return; }
      dropdown.innerHTML = '';
      data.employees.forEach(function(emp) {
        const item = document.createElement('div');
        item.className = 'emp-item';
        item.style.cssText = 'padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0f0f0;background:white;';
        const inactiveBadge = emp.isActive === false ? ' <span style="color:#ea4335;font-weight:600;">(Inactive)</span>' : '';
        item.innerHTML =
          '<div style="font-weight:700;font-size:13px;color:#1a73e8;">' + (emp.ein||'—') + inactiveBadge + '</div>' +
          '<div style="font-size:12px;color:#333;margin-top:2px;">' + emp.employeeName + '</div>' +
          '<div style="font-size:11px;color:#888;margin-top:1px;">' + (emp.designation||'—') + ' | ' + emp.location + '</div>';
        item.addEventListener('mouseenter', function() { this.style.background = '#f0f7ff'; });
        item.addEventListener('mouseleave', function() { this.style.background = 'white'; });
        item.addEventListener('click', function() {
          input.value = emp.ein || emp.employeeName;
          dropdown.style.display = 'none';
          if (onSelect) onSelect(emp);
        });
        dropdown.appendChild(item);
      });
      dropdown.style.display = 'block';
    } catch(e) { dropdown.style.display = 'none'; }
  }

  document.addEventListener('click', function(e) {
    if (!wrapper.contains(e.target)) dropdown.style.display = 'none';
  });
}
