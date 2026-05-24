/**
 * Parses OOXML DrawingML chart XML (from DOCX word/charts/ or XLSX xl/charts/)
 * and returns a Markdown table of the underlying series data.
 *
 * Uses localName matching so namespace prefixes (c:, c14:, etc.) don't matter.
 */

const CHART_TYPE_LABELS: Record<string, string> = {
	barchart: 'Bar', bar3dchart: 'Bar', linechart: 'Line', line3dchart: 'Line',
	piechart: 'Pie', pie3dchart: 'Pie', doughnutchart: 'Doughnut',
	areachart: 'Area', area3dchart: 'Area', scatterchart: 'Scatter',
	bubblechart: 'Bubble', radarchart: 'Radar', stockchart: 'Stock',
	ofpiechart: 'Pie of Pie', surfacechart: 'Surface', surface3dchart: 'Surface',
};

/** Find all descendants whose localName (lowercased) matches. */
function byLocal(node: Document | Element, localName: string): Element[] {
	const root = node instanceof Document ? node.documentElement : node;
	const lower = localName.toLowerCase();
	return Array.from(root.getElementsByTagName('*')).filter(el => el.localName.toLowerCase() === lower);
}

/** Find first descendant whose localName (lowercased) matches. */
function firstLocal(node: Document | Element, localName: string): Element | undefined {
	return byLocal(node, localName)[0];
}

/** Extract data point values indexed by c:pt[@idx] inside a c:cat / c:val element. */
function extractPts(el: Element): string[] {
	const pts = byLocal(el, 'pt');
	if (pts.length > 0) {
		const map = new Map<number, string>();
		for (const pt of pts) {
			const idx = parseInt(pt.getAttribute('idx') ?? '0');
			const v = firstLocal(pt, 'v');
			map.set(idx, v?.textContent?.trim() ?? '');
		}
		const maxIdx = Math.max(...map.keys());
		return Array.from({ length: maxIdx + 1 }, (_, i) => map.get(i) ?? '');
	}
	// Bare <v> elements (uncommon fallback)
	return byLocal(el, 'v').map(v => v.textContent?.trim() ?? '');
}

export function parseChartXml(xml: string): string | null {
	let doc: Document;
	try {
		doc = new DOMParser().parseFromString(xml, 'text/xml');
		if (doc.getElementsByTagName('parsererror').length > 0) return null;
	} catch {
		return null;
	}

	// Detect chart type by localName (any namespace prefix)
	let chartLabel = 'Chart';
	for (const el of Array.from(doc.getElementsByTagName('*'))) {
		const label = CHART_TYPE_LABELS[el.localName.toLowerCase()];
		if (label) { chartLabel = `${label} Chart`; break; }
	}

	// Chart title — rich text (a:t) or cached string (v inside title)
	let chartTitle = '';
	const titleEl = firstLocal(doc, 'title');
	if (titleEl) {
		// Rich-text: look for <a:t> (localName = 't') inside the title's tx/rich subtree
		const richTxEl = firstLocal(titleEl, 'tx');
		const tEls = richTxEl ? byLocal(richTxEl, 't') : byLocal(titleEl, 't');
		chartTitle = tEls.map(t => t.textContent ?? '').join('').trim();
		if (!chartTitle) {
			// String-ref cache: <c:strCache><c:pt><c:v>
			chartTitle = byLocal(titleEl, 'v').map(v => v.textContent?.trim() ?? '').join('').trim();
		}
	}

	// All series
	const serEls = byLocal(doc, 'ser');
	if (serEls.length === 0) return null;

	// Categories from the first series that has them
	let categories: string[] = [];
	for (const ser of Array.from(serEls)) {
		const catEl = firstLocal(ser, 'cat') ?? firstLocal(ser, 'xval');
		if (catEl) { categories = extractPts(catEl); break; }
	}

	// Series names and value arrays
	const series = Array.from(serEls).map(ser => {
		let name = 'Value';
		const txEl = firstLocal(ser, 'tx');
		if (txEl) {
			// Rich-text name (a:t) or strCache name (v)
			const tEls = byLocal(txEl, 't');
			const fromT = tEls.map(t => t.textContent ?? '').join('').trim();
			const fromV = byLocal(txEl, 'v').map(v => v.textContent?.trim() ?? '').join('').trim();
			name = fromT || fromV || 'Value';
		}
		const valEl = firstLocal(ser, 'val') ?? firstLocal(ser, 'yval');
		return { name, vals: valEl ? extractPts(valEl) : [] };
	});

	const maxLen = Math.max(categories.length, ...series.map(s => s.vals.length));
	if (maxLen === 0) return null;

	const label = chartTitle ? `${chartTitle} (${chartLabel})` : chartLabel;
	const headers = ['Category', ...series.map(s => s.name)];
	const rows: string[][] = Array.from({ length: maxLen }, (_, i) => [
		categories[i] ?? String(i + 1),
		...series.map(s => s.vals[i] ?? ''),
	]);

	const fmt = (cols: string[]) =>
		`| ${cols.map(c => c.replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`;

	return [
		`### ${label}`,
		'',
		fmt(headers),
		`| ${headers.map(() => '---').join(' | ')} |`,
		...rows.map(fmt),
	].join('\n');
}
