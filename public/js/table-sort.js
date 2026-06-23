// Reusable table sorting utility
// Usage: attach to <th> via onclick="sortTableBy('myArrayVarName', 'fieldName', 'sortStateObjName', rerenderFnName)"

function genericSort(array, field, direction) {
  return [...array].sort((a, b) => {
    let valA = a[field];
    let valB = b[field];

    // Handle nested/undefined gracefully
    if (valA === undefined || valA === null) valA = '';
    if (valB === undefined || valB === null) valB = '';

    // Try numeric comparison first
    const numA = parseFloat(valA);
    const numB = parseFloat(valB);
    const bothNumeric = !isNaN(numA) && !isNaN(numB) && valA !== '' && valB !== '';

    if (bothNumeric) {
      return direction === 'asc' ? numA - numB : numB - numA;
    }

    // Try date comparison
    const dateA = new Date(valA);
    const dateB = new Date(valB);
    const bothDates = !isNaN(dateA.getTime()) && !isNaN(dateB.getTime()) &&
      typeof valA === 'string' && valA.length > 6 && /\d{4}/.test(valA);

    if (bothDates) {
      return direction === 'asc' ? dateA - dateB : dateB - dateA;
    }

    // Fallback to string comparison
    const strA = String(valA).toLowerCase();
    const strB = String(valB).toLowerCase();
    if (strA < strB) return direction === 'asc' ? -1 : 1;
    if (strA > strB) return direction === 'asc' ? 1 : -1;
    return 0;
  });
}

// Renders sort arrow indicators on table headers
// sortState should be an object like { field: 'name', direction: 'asc' }
function renderSortIndicator(field, sortState) {
  if (!sortState || sortState.field !== field) return ' <span style="opacity:0.3;font-size:10px;">⇅</span>';
  return sortState.direction === 'asc' ?
    ' <span style="font-size:10px;">▲</span>' :
    ' <span style="font-size:10px;">▼</span>';
}
