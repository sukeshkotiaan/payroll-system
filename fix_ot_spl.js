const fs = require('fs');
let content = fs.readFileSync('public/pages/attendance.html', 'utf8');

// 1. Remove SpL from legend bar
content = content.replace(/<span[^>]*class="status-SpL"[^>]*>SpL<\/span>/g, '');

// 2. Remove SpL from STATUS_COLORS
content = content.replace(", SpL:'status-SpL'", '');

// 3. Remove SpL column header from grid
content = content.replace('<th class="total-header">SpL</th>', '');

// 4. Remove OT from column header (if still present)
content = content.replace('<th class="total-header">OT</th>', '');

// 5. Fix prompt and valid statuses - remove SpL and OT
content = content.replace(
  "const status = prompt('Enter status (P/A/WO/H/CL/SL/PL/SpL/HD/OT):');",
  "const status = prompt('Enter status (P/A/WO/H/CL/SL/PL/HD):');"
);
content = content.replace(
  "const valid = ['P','A','WO','H','CL','SL','PL','SpL','HD','OT'];",
  "const valid = ['P','A','WO','H','CL','SL','PL','HD'];"
);

// 6. Fix validStatuses array in upload processing
content = content.replace(
  "const validStatuses = ['P','A','CL','SL','PL','SpL','H','WO','HD','OT'];",
  "const validStatuses = ['P','A','CL','SL','PL','H','WO','HD'];"
);

// 7. Remove SpL from updateSummary calculation
content = content.replace("else if (d.status==='SpL') { spL++; p++; }", '');

// 8. Fix Excel template COUNTIF formula - remove OT and SpL
content = content.replace(
  'COUNTIF('+rng+',"P")+COUNTIF('+rng+',"OT")+COUNTIF('+rng+',"CL")+COUNTIF('+rng+',"SL")+COUNTIF('+rng+',"PL")+COUNTIF('+rng+',"SpL")+COUNTIF('+rng+',"HD")*0.5',
  ''
);

fs.writeFileSync('public/pages/attendance.html', content);
console.log('Done');
