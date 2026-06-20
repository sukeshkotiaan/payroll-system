const fs = require('fs');
let content = fs.readFileSync('public/pages/employees.html', 'utf8');

const jsFunctions = `
  async function goToExperienceLetterPopup(employeeId) {
    try {
      const exitRes = await fetch('/api/exits?status=Approved');
      const exitData = await exitRes.json();
      if (!exitData.success) { alert('Could not load exit records'); return; }
      const matched = exitData.exits.find(function(ex) {
        const exEmpId = ex.employeeId && ex.employeeId._id ? ex.employeeId._id : ex.employeeId;
        return String(exEmpId) === String(employeeId);
      });
      if (!matched) {
        alert('No approved exit record found for this employee. Experience letter requires an approved exit.');
        return;
      }
      await renderExperienceLetter(matched, employeeId);
    } catch(e) { alert('Error: ' + e.message); }
  }

  function fmtDateUTC(d) {
    const dt = new Date(d);
    const day = String(dt.getUTCDate()).padStart(2,'0');
    const mon = String(dt.getUTCMonth()+1).padStart(2,'0');
    const yr = dt.getUTCFullYear();
    return day + ' / ' + mon + ' / ' + yr;
  }

  async function renderExperienceLetter(ed, employeeId) {
    let dateOfJoining = null;
    let gender = '';
    try {
      const empRes = await fetch('/api/employees/' + employeeId);
      const empData = await empRes.json();
      if (empData.success) {
        dateOfJoining = empData.employee.dateOfJoining;
        gender = (empData.employee.gender || '').toLowerCase();
      }
    } catch(e) {}

    const heShe = gender === 'female' ? 'she' : gender === 'male' ? 'he' : 'he/she';
    const HeShe = gender === 'female' ? 'She' : gender === 'male' ? 'He' : 'He/She';
    const hisHer = gender === 'female' ? 'her' : gender === 'male' ? 'his' : 'his/her';
    const himHer = gender === 'female' ? 'her' : gender === 'male' ? 'him' : 'him/her';

    const joinStr = dateOfJoining ? fmtDateUTC(dateOfJoining) : '___ / ___ / ______';
    const lwdStr = ed.lastWorkingDate ? fmtDateUTC(ed.lastWorkingDate) : '___ / ___ / ______';
    const todayStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

    const html = '<div style="font-family:Georgia, serif;line-height:1.8;color:#1a1a1a;">' +
      '<div style="height:140px;"></div>' +
      '<div style="text-align:right;font-size:13px;margin-bottom:25px;color:#555;">Date: ' + todayStr + '</div>' +
      '<div style="text-align:center;font-weight:700;font-size:15px;margin-bottom:25px;letter-spacing:0.5px;">TO WHOMSOEVER IT MAY CONCERN</div>' +
      '<p style="margin-bottom:18px;font-size:13.5px;">This is to certify that <strong>' + ed.employeeName + '</strong> was employed with our school as ' +
      '<strong>' + (ed.designation || '____________________') + '</strong> from <strong>' + joinStr + '</strong> to <strong>' + lwdStr + '</strong>.</p>' +
      '<p style="margin-bottom:18px;font-size:13.5px;">During the tenure of employment, ' + heShe + ' discharged ' + hisHer + ' duties sincerely, diligently, and efficiently. ' +
      HeShe + ' consistently demonstrated professional competence, dedication to assigned responsibilities, and a positive attitude towards work.</p>' +
      '<p style="margin-bottom:18px;font-size:13.5px;">' + HeShe + ' maintained cordial relationships with colleagues, students, parents, and other stakeholders and contributed positively ' +
      'to the growth and development of the institution. Throughout the period of service, ' + hisHer + ' conduct and performance were found to be satisfactory.</p>' +
      '<p style="margin-bottom:40px;font-size:13.5px;">We appreciate ' + hisHer + ' services and valuable contributions to our school. We wish ' + himHer + ' every success in all future endeavors.</p>' +
      '<div style="margin-top:50px;font-size:13.5px;"><strong>Principal / Head of Institution</strong></div>' +
      '</div>';

    document.getElementById('letterPreviewArea').innerHTML = html;
    document.getElementById('letterOverlay').style.display = 'block';
    document.getElementById('letterModal').style.display = 'flex';
  }

  function closeLetterModal() {
    document.getElementById('letterOverlay').style.display = 'none';
    document.getElementById('letterModal').style.display = 'none';
  }

  function printLetter() {
    const html = document.getElementById('letterPreviewArea').innerHTML;
    const win = window.open('', '_blank');
    win.document.write('<html><head><title>Experience Letter</title></head><body style="padding:40px;">' + html + '</body></html>');
    win.document.close();
    setTimeout(function() { win.print(); }, 300);
  }
`;

const target = '    XLSX.writeFile(wb, \\'Employee_Import_Template.xlsx\\');\n  }\n</script>';
console.log('Target found:', content.includes(target));

if (content.includes(target)) {
  content = content.replace(target, '    XLSX.writeFile(wb, \\'Employee_Import_Template.xlsx\\');\n  }\n' + jsFunctions + '</script>');
  fs.writeFileSync('public/pages/employees.html', content);
  console.log('Done');
} else {
  console.log('NOT REPLACED');
}
