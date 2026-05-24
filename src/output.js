export function printJson(value) {
    console.log(JSON.stringify(value, null, 2));
}

export function printRows(rows, columns) {
    if (!rows.length) {
        console.log('(no rows)');
        return;
    }
    const widths = columns.map((column) => Math.max(
        column.label.length,
        ...rows.map((row) => String(column.get(row) ?? '').length),
    ));
    console.log(columns.map((column, index) => column.label.padEnd(widths[index])).join('  '));
    console.log(widths.map((width) => '-'.repeat(width)).join('  '));
    for (const row of rows) {
        console.log(columns.map((column, index) => String(column.get(row) ?? '').padEnd(widths[index])).join('  '));
    }
}
