// Editor Plus media and data blocks (EDITOR_PLUS_SPEC.md, section C): gallery,
// image compare, chart, stat highlights, file card and quote. Stored
// documents round-trip through JSON and HTML, renderHTML is meaningful
// without JS (a chart is real SVG), the chart model does its maths right,
// StaticCanva renders interactive views, and the slash items and data grid
// produce valid documents.
import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { Window } from "happy-dom";

const domWindow = new Window({ url: "http://localhost/" });
for (const key of [
  "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "Text", "DocumentFragment",
  "MutationObserver", "Range", "Selection", "DOMParser", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
  "CustomEvent", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "InputEvent", "FocusEvent", "ClipboardEvent", "NodeFilter", "DOMException",
  "localStorage", "sessionStorage",
]) {
  if (domWindow[key] !== undefined && globalThis[key] === undefined) globalThis[key] = domWindow[key];
}
globalThis.window ??= domWindow;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
document.documentElement.lang = "en";

const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Editor, getSchema, getHTMLFromFragment } = await import("@tiptap/core");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const { DOMParser: PMDOMParser } = await import("@tiptap/pm/model");
const { renderToHTMLString } = await import("@tiptap/static-renderer/pm/html-string");
const { default: StaticCanva } = await import("../components/Objects/Activities/StaticCanva/StaticCanva.tsx");

const MEDIA = "../components/Objects/Editor/Extensions/Plus/media/";
const C = await import(`${MEDIA}chartModel.ts`);
const M = await import(`${MEDIA}mediaModel.ts`);
const { createMediaNodes, MEDIA_NODE_NAMES } = await import(`${MEDIA}mediaNodes.ts`);
const { mediaExtensions, mediaSlashItems } = await import(`${MEDIA}index.ts`);
const { mediaLabels } = await import(`${MEDIA}labels.ts`);
const { specToReact, styleObject } = await import(`${MEDIA}views/svgSpec.tsx`);
const { default: ChartDataEditor } = await import(`${MEDIA}views/ChartDataEditor.tsx`);
const S = await import(`${MEDIA}views/shared.tsx`);
const { default: EditorOptionsProvider } = await import("../components/Contexts/Editor/EditorContext");
const { ReactNodeViewContentProvider } = await import("@tiptap/react");
const VIEWS = {
  gallery: (await import(`${MEDIA}views/GalleryView.tsx`)).default,
  imageCompare: (await import(`${MEDIA}views/ImageCompareView.tsx`)).default,
  chart: (await import(`${MEDIA}views/ChartView.tsx`)).default,
  statHighlights: (await import(`${MEDIA}views/StatHighlightsView.tsx`)).default,
  fileCard: (await import(`${MEDIA}views/FileCardView.tsx`)).default,
  quoteBlock: (await import(`${MEDIA}views/QuoteBlockView.tsx`)).default,
};

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/editor-blocks/media-blocks.json", import.meta.url), "utf8"));
const EVERY = fixtures.find((f) => f.name === "every-media-block").content;
const DEFAULTS = fixtures.find((f) => f.name === "defaults").content;

const base = StarterKit.configure({ codeBlock: false, undoRedo: false });
const extensions = (mode = "learner") => [base, ...createMediaNodes({ mode, activity: { activity_uuid: "act_1" } })];
const schema = getSchema(extensions());

const p = (text) => (text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" });
const doc = (...content) => ({ type: "doc", content });
const html = (json) => getHTMLFromFragment(schema.nodeFromJSON(json).content, schema);
const parseHTML = (markup) => {
  const el = document.createElement("div");
  el.innerHTML = markup;
  return PMDOMParser.fromSchema(schema).parse(el).toJSON();
};
const t = (_key, fallback, vars) => (vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : fallback);

describe("schema and round trips", () => {
  test("every fixture loads, checks and holds every media node", () => {
    const seen = new Set();
    for (const f of fixtures) {
      const node = schema.nodeFromJSON(f.content);
      expect(() => node.check()).not.toThrow();
      node.descendants((n) => void seen.add(n.type.name));
    }
    for (const name of MEDIA_NODE_NAMES) expect([name, seen.has(name)]).toEqual([name, true]);
  });

  test("JSON round trip keeps every stored attr and is stable", () => {
    for (const f of fixtures) {
      const once = schema.nodeFromJSON(f.content).toJSON();
      expect(once).toMatchObject(f.content);
      expect(schema.nodeFromJSON(once).toJSON()).toEqual(once);
    }
  });

  test("defaults fill in for nodes saved without attrs", () => {
    const out = schema.nodeFromJSON(DEFAULTS).toJSON().content;
    expect(out[0].attrs).toEqual({ blockId: null, layout: "grid", columns: 3, images: [] });
    expect(out[1].attrs).toEqual({ before: { label: "" }, after: { label: "" }, start: 50, orientation: "horizontal" });
    expect(out[2].attrs).toEqual({ type: "column", title: "", data: { labels: [], series: [] }, showLegend: true, showValues: false, stacked: false });
    expect(out[3].attrs).toEqual({ items: [], columns: 3, animate: true });
    expect(out[4].attrs).toEqual({ blockObject: null, url: null, name: "", description: null, sizeBytes: null, fileType: null });
    expect(out[5].attrs).toEqual({ variant: "pull", author: null, role: null, avatarUrl: null });
  });

  test("HTML written by the nodes parses back to the same document", () => {
    for (const f of fixtures) {
      expect(parseHTML(html(f.content))).toEqual(schema.nodeFromJSON(f.content).toJSON());
    }
  });

  test("HTML from elsewhere is cleaned when read (unsafe links, bad values, junk JSON)", () => {
    const out = parseHTML(
      '<figure data-type="gallery" data-layout="zigzag" data-columns="9" data-images=\'[{"id":"a","url":"javascript:alert(1)"},{"url":"https://x.test/a.png","alt":"A"},"junk"]\'></figure>' +
        '<div data-type="file-card" data-url="javascript:alert(1)" data-name="x" data-size="abc"></div>' +
        '<figure data-type="chart" data-chart="{not json" data-chart-type="radar"></figure>' +
        '<figure data-type="image-compare" data-start="250"></figure>',
    ).content;
    expect(out[0].attrs.layout).toBe("grid");
    expect(out[0].attrs.columns).toBe(3);
    expect(out[0].attrs.images.length).toBe(1);
    expect(out[0].attrs.images[0]).toMatchObject({ url: "https://x.test/a.png", alt: "A" });
    expect(out[1].attrs).toMatchObject({ url: null, name: "x", sizeBytes: null });
    expect(out[2].attrs).toMatchObject({ type: "column", data: { labels: [], series: [] } });
    expect(out[3].attrs.start).toBe(100);
  });

  test("a quote holds paragraphs only; the editor, preview and learner schemas are the same", () => {
    expect(() => schema.nodeFromJSON(doc({ type: "quoteBlock", content: [] })).check()).toThrow();
    expect(() => schema.nodeFromJSON(doc({ type: "quoteBlock", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "x" }] }] })).check()).toThrow();
    const spec = (s) => Object.fromEntries(MEDIA_NODE_NAMES.map((n) => [n, [s.nodes[n].spec.content ?? null, Object.keys(s.nodes[n].spec.attrs ?? {})]]));
    expect(spec(getSchema(extensions("editor")))).toEqual(spec(schema));
    expect(spec(getSchema(extensions("preview")))).toEqual(spec(schema));
    expect(spec(getSchema([base, ...mediaExtensions({ mode: "learner", activity: { activity_uuid: "a" } })]))).toEqual(spec(schema));
  });
});

describe("renderHTML is meaningful without JS (exports, @tiptap/static-renderer)", () => {
  const out = renderToHTMLString({ content: EVERY, extensions: extensions() });

  test("a gallery is a grid of figures with alt text and captions", () => {
    expect(out).toContain('data-type="gallery" class="lh-gallery-static" style="--lh-gallery-cols:4"');
    expect(out).toContain('<figure class="lh-gallery-item"><img alt="Rocky coastline under a pink sky" loading="lazy" src="https://images.example.com/coast.jpg"/><figcaption>The coast at dawn</figcaption></figure>');
    // Uploaded files need the org and course for their URL; the alt text stays.
    expect(out).toContain('<img alt="Tide pool with starfish" loading="lazy" data-block-uuid="block_g2"/>');
  });

  test("a comparison shows both images with their labels", () => {
    expect(out).toContain('<figure data-side="before"><img alt="1990" loading="lazy" src="https://images.example.com/before.jpg"/><figcaption>1990</figcaption></figure>');
    expect(out).toContain('<figure data-side="after"><img alt="The same valley with a new forest" loading="lazy" data-block-uuid="block_after"/><figcaption>2020</figcaption></figure>');
    const empty = renderToHTMLString({ content: doc({ type: "imageCompare" }), extensions: extensions() });
    expect(empty).toContain("<figcaption>Before</figcaption>");
    expect(empty).toContain("<figcaption>After</figcaption>");
  });

  test("a chart is server-drawn SVG with a title, a description, a legend and a data table", () => {
    expect(out).toContain('<figcaption class="lh-chart-title">Average quiz score by quarter</figcaption>');
    expect(out).toMatch(/<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="640" height="300" viewBox="0 0 640 300" role="img" class="lh-chart-svg"><title>Average quiz score by quarter<\/title><desc>Column chart of 2 series \(Class A, Class B\) over 4 categories, from 62 to 86\.<\/desc>/);
    expect((out.match(/<rect data-mark="/g) ?? []).length).toBe(8);
    expect(out).toContain('aria-label="Q3, Class A: 79"');
    expect(out).toContain('<ul class="lh-chart-legend"><li><span class="lh-chart-swatch" style="background:var(--color-lh-chart-1, #2a78d6)" aria-hidden="true"></span>Class A</li>');
    expect(out).toContain('<table class="lh-chart-table sr-only"><caption>Average quiz score by quarter</caption><thead><tr><th scope="col">Category</th><th scope="col">Class A</th><th scope="col">Class B</th></tr></thead><tbody><tr><th scope="row">Q1</th><td>68</td><td>62</td></tr>');
    // Donut: one slice path per label, the total in the middle, no legend.
    const donut = out.slice(out.indexOf('data-chart-type="donut"'));
    expect((donut.match(/<path data-mark="0-\d"/g) ?? []).length).toBe(3);
    expect(donut).toContain('aria-label="Practice: 50 (50%)"');
    expect(donut).toContain(">100</text>");
    expect(donut.slice(0, donut.indexOf("</figure>"))).not.toContain("lh-chart-legend");
  });

  test("an empty chart renders its title only", () => {
    const empty = renderToHTMLString({ content: doc({ type: "chart", attrs: { title: "Soon" } }), extensions: extensions() });
    expect(empty).toBe('<figure data-chart-type="column" data-title="Soon" data-chart="{&quot;labels&quot;:[],&quot;series&quot;:[]}" data-legend="true" data-values="false" data-stacked="false" data-type="chart" class="lh-chart lh-chart-static"><figcaption class="lh-chart-title">Soon</figcaption></figure>');
  });

  test("stats are a definition list with the full numbers", () => {
    expect(out).toContain('<div class="lh-stat" data-tone="teal"><dt>Completion rate</dt><dd class="lh-stat-value">92%</dd><dd class="lh-stat-desc">of learners finish the course</dd></div>');
    expect(out).toContain('<dd class="lh-stat-value">~12,500</dd>');
  });

  test("a file card is a link with its type and size", () => {
    expect(out).toContain('<strong class="lh-file-name">Field guide.pdf</strong><span class="lh-file-meta">PDF · 2.4 MB</span><p class="lh-file-desc">Print it before the trip.</p>');
    expect(out).toContain('<a href="https://files.example.com/packing-list.xlsx" target="_blank" rel="noopener noreferrer" class="lh-file-name">Packing list</a><span class="lh-file-meta">Spreadsheet</span>');
  });

  test("a quote is a figure around a blockquote with its author", () => {
    expect(out).toContain('<blockquote><p>The hands-on exercises made it click.</p><p>I used it the very next day.</p></blockquote><figcaption><img src="https://images.example.com/sam.jpg" alt="" class="lh-quote-avatar"/><cite>Sam Rivera</cite>, <span class="lh-quote-role">Product designer</span></figcaption></figure>');
    expect(out).toContain('<figure data-variant="pull" data-type="quote-block" class="lh-quote-static"><blockquote><p>Learning is not a spectator sport.</p></blockquote></figure>');
    expect(out).toContain("<blockquote><p>A plain quote still works.</p></blockquote>");
  });

  test("labels come from the translations", () => {
    const fr = { "activities.image_compare.before": "Avant", "activities.chart.summary": "{{type}} : {{series}} séries", "activities.chart.types.column": "Histogramme" };
    const tr = (k, f, v) => t(k, fr[k] ?? f, v);
    const ext = [base, ...createMediaNodes({ mode: "learner", labels: () => mediaLabels(tr, "fr") })];
    const outFr = renderToHTMLString({ content: doc({ type: "imageCompare" }, EVERY.content[3]), extensions: ext });
    expect(outFr).toContain("<figcaption>Avant</figcaption>");
    expect(outFr).toContain("<desc>Histogramme : 2 séries</desc>");
  });
});

describe("chart model", () => {
  test("nice numbers and ticks", () => {
    expect(C.niceNumber(87, false)).toBe(100);
    expect(C.niceNumber(23, true)).toBe(20);
    expect(C.niceNumber(0, true)).toBe(1);
    expect(C.niceTicks(62, 86)).toEqual({ min: 0, max: 100, step: 20, ticks: [0, 20, 40, 60, 80, 100] });
    expect(C.niceTicks(-12, 30).ticks).toEqual([-20, -10, 0, 10, 20, 30]);
    expect(C.niceTicks(0, 0)).toMatchObject({ min: 0, max: 1 });
    expect(C.niceTicks(0, 0.7).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
    expect(C.niceTicks(5, 5).ticks[0]).toBe(0);
    const big = C.niceTicks(0, 1234567);
    expect(big.ticks.at(-1)).toBeGreaterThanOrEqual(1234567);
  });

  test("tick, value and percent text", () => {
    expect(C.formatTick(1200, 200)).toBe("1.2k");
    expect(C.formatTick(3000000, 1000000)).toBe("3M");
    expect(C.formatTick(0.25, 0.05)).toBe("0.25");
    expect(C.formatTick(40, 20)).toBe("40");
    expect(C.formatTick(1500, 10)).toBe("1500");
    expect(C.formatValue(12500.456, "en-US")).toBe("12,500.46");
    expect(C.formatCompact(12500, "en-US")).toBe("12.5K");
    expect(C.formatCompact(4.567, "en-US")).toBe("4.57");
    expect(C.formatPercent(0.5, "en-US")).toBe("50%");
    expect(C.formatPercent(0.034, "en-US")).toBe("3.4%");
  });

  test("numbers typed or pasted from a sheet", () => {
    expect(C.parseNumber("1,234.5")).toBe(1234.5);
    expect(C.parseNumber("1.234,5")).toBe(1234.5);
    expect(C.parseNumber("1 234,5")).toBe(1234.5);
    expect(C.parseNumber("3,5")).toBe(3.5);
    expect(C.parseNumber("1,234")).toBe(1234);
    expect(C.parseNumber("12%")).toBe(12);
    expect(C.parseNumber("$40")).toBe(40);
    expect(C.parseNumber("-3")).toBe(-3);
    expect(C.parseNumber("(15)")).toBe(-15);
    expect(C.parseNumber("1.000.000")).toBe(1000000);
    expect(C.parseNumber("abc")).toBeNull();
    expect(C.parseNumber("")).toBeNull();
  });

  test("scales, bands and stacking", () => {
    const y = C.linearScale([0, 100], [300, 0]);
    expect([y(0), y(50), y(100)]).toEqual([300, 150, 0]);
    const band = C.bandScale(4, 0, 400, 0.25, 0);
    expect(band.step).toBeCloseTo(400 / 3.75);
    expect(band.bandwidth).toBeCloseTo(band.step * 0.75);
    expect(band.center(0)).toBeCloseTo(band.bandwidth / 2);
    const data = { labels: ["a", "b"], series: [{ name: "x", values: [3, -2], tone: null }, { name: "y", values: [4, -1], tone: null }] };
    expect(C.stackSeries(data)).toEqual([[[0, 3], [0, -2]], [[3, 7], [-2, -3]]]);
    expect(C.valueExtent(data, true)).toEqual([-3, 7]);
    expect(C.valueExtent(data, false)).toEqual([-2, 4]);
  });

  test("paths", () => {
    expect(C.linePath([[0, 10], [5.555, 20]])).toBe("M0 10L5.56 20");
    expect(C.areaPath([[0, 1], [2, 3]], [[0, 9], [2, 9]])).toBe("M0 1L2 3L2 9L0 9Z");
    expect(C.areaPath([], [])).toBe("");
    const quarter = C.arcPath(50, 50, 40, 0, -Math.PI / 2, 0);
    expect(quarter).toBe("M50 50L50 10A40 40 0 0 1 90 50Z");
    const donut = C.arcPath(50, 50, 40, 20, 0, Math.PI);
    expect(donut).toBe("M90 50A40 40 0 0 1 10 50L30 50A20 20 0 0 0 70 50Z");
    // A full circle is two halves (one arc cannot close on itself).
    expect((C.arcPath(50, 50, 40, 0, 0, Math.PI * 2).match(/A/g) ?? []).length).toBe(2);
    expect(C.arcPath(50, 50, 40, 0, 1, 1)).toBe("");
  });

  test("CSV and TSV parsing", () => {
    expect(C.detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(C.detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(C.detectDelimiter("just text")).toBe(",");
    expect(C.parseCsv('name,"note, with comma","say ""hi"""\r\nA,1,2\n\n')).toEqual([["name", "note, with comma", 'say "hi"'], ["A", "1", "2"]]);
    const data = C.csvToChartData("Quarter\tClass A\tClass B\nQ1\t68\t62\nQ2\t74\t70");
    expect(data).toEqual({ labels: ["Q1", "Q2"], series: [{ name: "Class A", values: [68, 74], tone: null }, { name: "Class B", values: [62, 70], tone: null }] });
    const noHeader = C.csvToChartData("Mon,3,4\nTue,5,x");
    expect(noHeader.series.map((s) => s.name)).toEqual(["Series 1", "Series 2"]);
    expect(noHeader.series[1].values).toEqual([4, 0]);
    expect(C.csvToChartData("4\n5\n6")).toMatchObject({ labels: ["1", "2", "3"], series: [{ values: [4, 5, 6] }] });
    expect(C.csvToChartData("hello\nworld")).toBeNull();
    expect(C.csvToChartData("")).toBeNull();
    expect(C.csvToChartData("Label,A")).toBeNull();
    const back = C.chartDataToCsv({ labels: ['Q1, early', 'Q"2'], series: [{ name: "A", values: [1, 2], tone: null }] }, "Quarter");
    expect(back).toBe('Quarter,A\n"Q1, early",1\n"Q""2",2');
    expect(C.csvToChartData(back).labels).toEqual(["Q1, early", 'Q"2']);
  });

  test("stored data is normalised", () => {
    expect(C.normalizeChartData(null)).toEqual({ labels: [], series: [] });
    const out = C.normalizeChartData({ labels: ["a", 2, null, " long "], series: [{ name: "s", values: ["3", null, Infinity, 4, 99], tone: "pink" }, "x", { values: [1] }] });
    expect(out.labels).toEqual(["a", "2", "", "long"]);
    expect(out.series).toEqual([{ name: "s", values: [3, 0, 0, 4], tone: "pink" }, { name: "", values: [1, 0, 0, 0], tone: null }]);
    const many = C.normalizeChartData({ labels: ["a"], series: Array.from({ length: 12 }, () => ({ name: "s", values: [1] })) });
    expect(many.series.length).toBe(C.MAX_SERIES);
    expect(C.isEmptyChart(out)).toBe(false);
    expect(C.chartTypeOf("radar")).toBe("column");
    expect(C.paletteIndex("teal", 5)).toBe(2);
    expect(C.paletteIndex(null, 9)).toBe(1);
    expect(C.seriesColor({ tone: "red" }, 0)).toBe("var(--color-lh-chart-8, #e34948)");
  });

  test("grid editing helpers keep series and labels aligned", () => {
    let d = C.sampleChartData((_k, f) => f);
    expect(d.series.length).toBe(2);
    expect(d.labels).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    d = C.addRow(d, "Q5");
    expect(d.series.every((s) => s.values.length === 5)).toBe(true);
    d = C.addSeries(d, "Class C");
    expect(d.series[2]).toEqual({ name: "Class C", values: [0, 0, 0, 0, 0], tone: null });
    d = C.setCell(d, 2, 4, 88);
    expect(d.series[2].values[4]).toBe(88);
    expect(C.setCell(d, 9, 0, 1)).toBe(d);
    d = C.setLabel(d, 4, "Summer");
    expect(d.labels[4]).toBe("Summer");
    d = C.setSeries(d, 2, { name: "C", tone: "violet" });
    expect(d.series[2]).toMatchObject({ name: "C", tone: "violet" });
    d = C.removeSeries(d, 0);
    expect(d.series.map((s) => s.name)).toEqual(["Class B", "C"]);
    d = C.removeRow(d, 0);
    expect(d.labels).toEqual(["Q2", "Q3", "Q4", "Summer"]);
    expect(d.series[0].values).toEqual([70, 72, 81, 0]);
    const one = { labels: ["a"], series: [{ name: "s", values: [1], tone: null }] };
    expect(C.removeRow(one, 0)).toBe(one);
    expect(C.removeSeries(one, 0)).toBe(one);
  });

  test("column, bar, line, area and stacked geometry", () => {
    const data = C.sampleChartData((_k, f) => f);
    const col = C.layoutChart(data, { type: "column", width: 640, height: 300 });
    expect(col.kind).toBe("cartesian");
    expect(col.marks.length).toBe(8);
    expect(col.valueTicks.map((tk) => tk.text)).toEqual(["0", "20", "40", "60", "80", "100"]);
    // Every bar sits inside the plot, grows from zero, and series sit side by side.
    for (const m of col.marks) {
      expect(m.x).toBeGreaterThanOrEqual(col.plot.x);
      expect(m.x + m.w).toBeLessThanOrEqual(col.plot.x + col.plot.w + 0.01);
      expect(m.y + m.h).toBeCloseTo(col.zero, 1);
    }
    const [a0, b0] = [col.marks.find((m) => m.series === 0 && m.index === 0), col.marks.find((m) => m.series === 1 && m.index === 0)];
    expect(b0.x).toBeGreaterThan(a0.x);
    expect(a0.h).toBeGreaterThan(b0.h);
    const bar = C.layoutChart(data, { type: "bar", width: 640, height: 300 });
    expect(bar.valueAxis).toBe("x");
    expect(bar.marks.every((m) => m.x >= bar.zero - 0.01)).toBe(true);
    const line = C.layoutChart(data, { type: "line", width: 640, height: 300 });
    expect(line.lines.length).toBe(2);
    expect(line.lines[0].area).toBeNull();
    expect(line.marks[0].cx).toBe(line.plot.x);
    expect(line.marks[3].cx).toBeCloseTo(line.plot.x + line.plot.w, 1);
    const area = C.layoutChart(data, { type: "area", stacked: true, width: 640, height: 300 });
    expect(area.lines[1].area).toMatch(/Z$/);
    const stacked = C.layoutChart(data, { type: "column", stacked: true, width: 640, height: 300 });
    expect(stacked.valueTicks.at(-1).value).toBeGreaterThanOrEqual(86 + 81);
    const top = stacked.marks.find((m) => m.series === 1 && m.index === 3);
    const below = stacked.marks.find((m) => m.series === 0 && m.index === 3);
    expect(top.y + top.h).toBeCloseTo(below.y, 1);
    expect(top.x).toBe(below.x);
    // A narrow column skips labels that would collide and gets a shorter chart.
    const many = { labels: Array.from({ length: 30 }, (_v, i) => `Week ${i + 1}`), series: [{ name: "s", values: Array.from({ length: 30 }, (_v, i) => i), tone: null }] };
    const narrow = C.layoutChart(many, { type: "column", width: 320 });
    expect(narrow.height).toBe(C.CHART_HEIGHT_NARROW);
    expect(narrow.categoryTicks.filter((c) => c.visible).length).toBeLessThan(30);
  });

  test("pie and donut geometry", () => {
    const data = { labels: ["a", "b", "c", "d"], series: [{ name: "s", values: [1, 1, 2, -5], tone: null }] };
    const pie = C.layoutChart(data, { type: "pie", width: 400, height: 300 });
    expect(pie.total).toBe(4);
    expect(pie.slices.map((s) => s.share)).toEqual([0.25, 0.25, 0.5, 0]);
    expect(pie.slices[3].d).toBe("");
    expect(pie.inner).toBe(0);
    const donut = C.layoutChart(data, { type: "donut", width: 400, height: 300 });
    expect(donut.inner).toBeCloseTo(donut.outer * 0.6);
    expect(C.markLabel(data, donut, 0, 2)).toBe("c: 2 (50%)");
  });

  test("the SVG tree marks every value for tooltips and screen readers", () => {
    const data = C.sampleChartData((_k, f) => f);
    const geo = C.layoutChart(data, { type: "line", width: 500, height: 260 });
    const svg = C.chartSvg(geo, { title: "T", desc: "D", data, showValues: true, active: "1-2" });
    const flat = JSON.stringify(svg);
    expect(svg[0]).toBe("svg");
    expect(svg[2]).toEqual(["title", {}, "T"]);
    expect((flat.match(/"data-mark"/g) ?? []).length).toBe(8);
    expect(flat).toContain('"class":"lh-chart-mark is-active"');
    expect(flat).toContain('"aria-label":"Q3, Class B: 72"');
    expect(C.chartSummary(data, "line")).toBe("Line chart of 2 series (Class A, Class B) over 4 categories, from 62 to 86.");
    const table = C.chartTable(data, "Scores");
    expect(table[0]).toBe("table");
    expect(JSON.stringify(table)).toContain('["td",{},"86"]');
  });
});

describe("media model", () => {
  test("stat values count up in their own format", () => {
    expect(M.parseStatValue("12,500")).toEqual({ head: "", number: 12500, decimals: 0, grouped: true, tail: "" });
    expect(M.parseStatValue("~4.8k")).toEqual({ head: "~", number: 4.8, decimals: 1, grouped: false, tail: "k" });
    expect(M.parseStatValue("n/a").number).toBeNull();
    expect(M.statFrame("12,500", 0)).toBe("0");
    expect(M.statFrame("12,500", 0.5)).toBe("10,938");
    expect(M.statFrame("12,500", 1)).toBe("12,500");
    expect(M.statFrame("4.8", 0)).toBe("0.0");
    expect(M.statFrame("n/a", 0.3)).toBe("n/a");
    expect(M.easeOut(0)).toBe(0);
    expect(M.easeOut(1)).toBe(1);
    expect(M.easeOut(2)).toBe(1);
  });

  test("the comparison divider follows keys and pointers", () => {
    expect(M.compareKeyStep("ArrowRight", 50, "horizontal")).toBe(51);
    expect(M.compareKeyStep("ArrowLeft", 50, "horizontal")).toBe(49);
    expect(M.compareKeyStep("ArrowDown", 50, "vertical")).toBe(51);
    expect(M.compareKeyStep("ArrowUp", 50, "vertical")).toBe(49);
    expect(M.compareKeyStep("PageUp", 95, "horizontal")).toBe(100);
    expect(M.compareKeyStep("PageDown", 5, "vertical")).toBe(0);
    expect(M.compareKeyStep("Home", 40, "horizontal")).toBe(0);
    expect(M.compareKeyStep("End", 40, "horizontal")).toBe(100);
    expect(M.compareKeyStep("a", 40, "horizontal")).toBeNull();
    const rect = { left: 100, top: 50, width: 200, height: 100 };
    expect(M.pointerPercent(rect, 150, 0, "horizontal")).toBe(25);
    expect(M.pointerPercent(rect, 0, 125, "vertical")).toBe(75);
    expect(M.pointerPercent(rect, 999, 0, "horizontal")).toBe(100);
    expect(M.clampPercent("abc")).toBe(50);
    expect(M.clampPercent(-4)).toBe(0);
  });

  test("normalisers keep valid entries only", () => {
    const images = M.normalizeGalleryImages([{ id: "a", url: "https://x.test/1.png", alt: " A " }, { id: "a", url: "/media/2.png" }, { url: "ftp://nope" }, { blockObject: { block_uuid: "b", content: { file_id: "f", file_format: "png" } } }, 3]);
    expect(images.length).toBe(3);
    expect(images[0]).toEqual({ id: "a", url: "https://x.test/1.png", alt: "A" });
    expect(images[1].id).not.toBe("a");
    expect(images[2].blockObject.block_uuid).toBe("b");
    expect(M.normalizeGalleryImages("junk")).toEqual([]);
    expect(M.missingAltCount(images)).toBe(2);
    const stats = M.normalizeStats([{ value: 42, label: "Answer", tone: "mauve", prefix: "" }, null]);
    expect(stats.length).toBe(1);
    expect(stats[0]).toMatchObject({ value: "42", label: "Answer" });
    expect(stats[0].tone).toBeUndefined();
    expect(M.normalizeCompareSide({ url: "javascript:x", label: "L" }, "Before")).toEqual({ label: "L" });
    expect(M.normalizeCompareSide(null, "Before")).toEqual({ label: "Before" });
  });

  test("links, files and lists", () => {
    expect(M.safeUrl("https://x.test/a")).toBe("https://x.test/a");
    expect(M.safeUrl("//cdn.test/a")).toBe("//cdn.test/a");
    expect(M.safeUrl("/content/a.png")).toBe("/content/a.png");
    expect(M.safeUrl("javascript:alert(1)")).toBeNull();
    expect(M.safeUrl("data:text/html,x")).toBeNull();
    expect(M.fileTypeOf("Report.DOCX")).toBe("doc");
    expect(M.fileTypeOf("https://x.test/a/data.csv?x=1")).toBe("sheet");
    expect(M.fileTypeOf("README")).toBe("file");
    expect(M.fileTypeOf("pdf")).toBe("pdf");
    expect(M.fileNameFromUrl("https://x.test/files/My%20notes.pdf")).toBe("My notes.pdf");
    expect(M.formatFileSize(2516582, "en-US")).toBe("2.4 MB");
    expect(M.formatFileSize(512, "en-US")).toBe("512 B");
    expect(M.formatFileSize(null)).toBeNull();
    expect(M.blockDirectory({ block_type: "BLOCK_DOCUMENT_PDF" })).toBe("pdfBlock");
    expect(M.blockDirectory({ block_type: "BLOCK_AUDIO" })).toBe("audioBlock");
    expect(M.blockDirectory({ block_type: "BLOCK_VIDEO" })).toBe("videoBlock");
    expect(M.blockDirectory(null)).toBe("imageBlock");
    expect(M.blockFileName({ content: { file_id: "f", file_format: "png" } })).toBe("f.png");
    expect(M.moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(M.moveItem([1, 2], 0, 5)).toEqual([1, 2]);
    expect(M.wrapIndex(-1, 3)).toBe(2);
    expect(M.wrapIndex(3, 3)).toBe(0);
    expect(M.wrapIndex(1, 0)).toBe(0);
    expect(new Set(Array.from({ length: 50 }, () => M.newId())).size).toBe(50);
  });

  test("svg spec to React", () => {
    expect(styleObject("fill:red;stroke-width:2;--x:1;bad")).toEqual({ fill: "red", strokeWidth: "2", "--x": "1" });
    const el = specToReact(["svg", { xmlns: "x", class: "c", tabindex: "0", "text-anchor": "end" }, ["title", {}, "T"]]);
    expect(el.type).toBe("svg");
    expect(el.props).toMatchObject({ className: "c", tabIndex: "0", textAnchor: "end" });
    expect(el.props.xmlns).toBeUndefined();
  });
});

// ── StaticCanva in the browser ──────────────────────────────────────────────

let mounted = [];
afterEach(async () => {
  for (const { root, el } of mounted) {
    await act(async () => root.unmount());
    el.remove();
  }
  mounted = [];
});

const flush = (ms = 5) => act(async () => new Promise((r) => setTimeout(r, ms)));
async function mount(content, selector) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(React.createElement(StaticCanva, { content, activity: { activity_uuid: "act_1" } })));
  mounted.push({ root, el });
  // Block views are lazy chunks; wait until they are on the page.
  for (let i = 0; i < 200 && selector && !el.querySelector(selector); i++) await flush();
  return el;
}
const click = (node) => act(async () => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
const key = (node, k) => act(async () => node.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true })));

describe("StaticCanva", () => {
  test("every block renders its learner view", async () => {
    const el = await mount(EVERY, ".lh-quote-block, .lh-gallery");
    for (const sel of [".lh-gallery", ".lh-image-compare", ".lh-chart svg", ".lh-stat-highlights", ".lh-file-card", ".lh-quote-block"]) {
      for (let i = 0; i < 100 && !el.querySelector(sel); i++) await flush();
      expect([sel, !!el.querySelector(sel)]).toEqual([sel, true]);
    }
    expect(el.textContent).toContain("The hands-on exercises made it click.");
    expect(el.querySelector(".lh-quote-block cite").textContent).toBe("Sam Rivera");
    expect(el.querySelector(".lh-quote-block blockquote").textContent).toContain("I used it the very next day.");
  });

  test("gallery carousel: arrows, dots, keys and swipes", async () => {
    const el = await mount(EVERY, ".lh-gallery-carousel");
    const region = el.querySelector('.lh-gallery-carousel[role="region"]');
    const current = () => [...region.querySelectorAll('[aria-roledescription="slide"]')].findIndex((s) => s.getAttribute("aria-hidden") === "false");
    const dots = () => [...region.querySelectorAll("button[aria-current], button[aria-label^='Show image']")];
    expect(region.querySelectorAll("img").length).toBe(3);
    expect(region.querySelector("img").getAttribute("alt")).toBe("Rocky coastline under a pink sky");
    // The uploaded image's URL is built from the org, course, activity and block.
    expect(region.querySelectorAll("img")[1].getAttribute("src")).toContain("/activities/act_1/dynamic/blocks/imageBlock/block_g2/file_g2.png");
    expect(current()).toBe(0);
    await click(region.querySelector('button[aria-label="Next image"]'));
    expect(current()).toBe(1);
    await click(region.querySelector('button[aria-label="Previous image"]'));
    await click(region.querySelector('button[aria-label="Previous image"]'));
    expect(current()).toBe(2);
    await click(dots()[0]);
    expect(current()).toBe(0);
    expect(dots()[0].getAttribute("aria-current")).toBe("true");
    await key(region, "ArrowRight");
    expect(current()).toBe(1);
    await key(region, "End");
    expect(current()).toBe(2);
    await key(region, "Home");
    expect(current()).toBe(0);
    expect(region.textContent).toContain("The coast at dawn");
    // Swipe left goes forward.
    const viewport = region.querySelector('[style*="touch-action"]');
    const pointer = (type, x) => act(async () => viewport.dispatchEvent(new window.PointerEvent(type, { bubbles: true, clientX: x, pointerId: 1, pointerType: "touch" })));
    await pointer("pointerdown", 300);
    await pointer("pointermove", 120);
    await pointer("pointerup", 120);
    expect(current()).toBe(1);
  });

  test("gallery grid and masonry: tiles that open the lightbox, with alt text and captions", async () => {
    // (The lightbox itself is the shared Radix dialog, which happy-dom can't drive; its stepping is wrapIndex.)
    const content = doc({ ...EVERY.content[1], attrs: { ...EVERY.content[1].attrs, layout: "grid", columns: 3 } }, { ...EVERY.content[1], attrs: { ...EVERY.content[1].attrs, layout: "masonry", columns: 2 } });
    const el = await mount(content, ".lh-gallery button");
    for (let i = 0; i < 100 && el.querySelectorAll(".lh-gallery").length < 2; i++) await flush();
    const [grid, masonry] = el.querySelectorAll(".lh-gallery");
    const tiles = [...grid.querySelectorAll('button[aria-label^="Open image"]')];
    expect(tiles.length).toBe(3);
    expect(tiles[0].getAttribute("aria-label")).toBe("Open image 1 of 3");
    expect(grid.querySelector('[role="group"]').getAttribute("aria-label")).toBe("Image gallery");
    expect(grid.querySelector(".grid").className).toContain("sm:grid-cols-3");
    expect([...grid.querySelectorAll("figcaption")].map((f) => f.textContent)).toEqual(["The coast at dawn", "Lighthouse"]);
    expect([...grid.querySelectorAll("img")].map((i) => i.getAttribute("alt"))).toEqual(["Rocky coastline under a pink sky", "Tide pool with starfish", ""]);
    expect(masonry.getAttribute("data-layout")).toBe("masonry");
    expect(masonry.querySelector(".columns-2")).toBeTruthy();
  });

  test("image compare: a keyboard slider that moves the divider", async () => {
    const el = await mount(doc(EVERY.content[2]), '[role="slider"]');
    const slider = el.querySelector('[role="slider"]');
    expect(slider.getAttribute("aria-valuenow")).toBe("30");
    expect(slider.getAttribute("aria-orientation")).toBe("vertical");
    expect(slider.getAttribute("aria-valuetext")).toBe("1990 30%, 2020 70%");
    await key(slider, "ArrowDown");
    expect(slider.getAttribute("aria-valuenow")).toBe("31");
    await key(slider, "PageUp");
    expect(slider.getAttribute("aria-valuenow")).toBe("41");
    await key(slider, "End");
    expect(slider.getAttribute("aria-valuenow")).toBe("100");
    expect(slider.style.top).toBe("100%");
    const after = el.querySelectorAll(".lh-compare-stage img")[1];
    expect(after.getAttribute("alt")).toBe("The same valley with a new forest");
    expect(after.style.clipPath).toBe("inset(100% 0 0 0)");
  });

  test("chart: SVG marks show a tooltip on hover and focus, with a hidden data table", async () => {
    const el = await mount(doc(EVERY.content[3]), ".lh-chart svg");
    const svg = el.querySelector(".lh-chart svg");
    expect(svg.querySelector("title").textContent).toBe("Average quiz score by quarter");
    expect(svg.querySelectorAll("[data-mark]").length).toBe(8);
    expect(el.querySelector(".lh-chart table caption").textContent).toBe("Average quiz score by quarter");
    expect([...el.querySelectorAll(".lh-chart ul li")].map((li) => li.textContent)).toEqual(["Class A", "Class B"]);
    const mark = svg.querySelector('[data-mark="1-3"]');
    await act(async () => mark.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true })));
    const tip = () => el.querySelector(".lh-chart-tooltip");
    expect(tip().textContent).toContain("Q4");
    expect(tip().textContent).toContain("Class B");
    expect(tip().textContent).toContain("81");
    expect(svg.querySelector('[data-mark="1-3"]').getAttribute("class")).toContain("is-active");
    await act(async () => mark.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true })));
    expect(tip()).toBeNull();
    await act(async () => svg.querySelector('[data-mark="0-0"]').dispatchEvent(new window.PointerEvent("pointerover", { bubbles: true })));
    expect(tip().textContent).toContain("Q1");
  });

  test("stats show final numbers at once with reduced motion, and count up otherwise", async () => {
    const original = window.matchMedia;
    window.matchMedia = (q) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} });
    try {
      const el = await mount(doc(EVERY.content[5]), ".lh-stat");
      expect([...el.querySelectorAll(".lh-stat [aria-hidden]")].map((n) => n.textContent)).toEqual(["92%", "4.8/5", "~12,500"]);
      expect(el.querySelector(".lh-stat .sr-only").textContent).toBe("92%");
    } finally {
      window.matchMedia = original;
    }
    let observed = null;
    globalThis.IntersectionObserver = class {
      constructor(cb) {
        observed = cb;
      }
      observe() {}
      disconnect() {}
    };
    try {
      const el = await mount(doc(EVERY.content[5]), ".lh-stat");
      const shown = () => [...el.querySelectorAll(".lh-stat [aria-hidden]")].map((n) => n.textContent);
      expect(shown()).toEqual(["0%", "0.0/5", "~0"]);
      // Screen readers always get the real value.
      expect(el.querySelector(".lh-stat .sr-only").textContent).toBe("92%");
      await act(async () => observed([{ isIntersecting: true }]));
      for (let i = 0; i < 100 && shown()[0] !== "92%"; i++) await flush(30);
      expect(shown()).toEqual(["92%", "4.8/5", "~12,500"]);
    } finally {
      delete globalThis.IntersectionObserver;
    }
  });

  test("file cards: a download link with type, size and description", async () => {
    const el = await mount(doc(EVERY.content[6], EVERY.content[7]), ".lh-file-card a");
    for (let i = 0; i < 100 && el.querySelectorAll(".lh-file-card a").length < 2; i++) await flush();
    const [pdf, sheet] = el.querySelectorAll(".lh-file-card");
    expect(pdf.textContent).toContain("Field guide.pdf");
    expect(pdf.textContent).toContain("PDF · 2.4 MB");
    expect(pdf.textContent).toContain("Print it before the trip.");
    expect(pdf.querySelector("a").getAttribute("href")).toContain("/dynamic/blocks/pdfBlock/block_pdf/file_pdf.pdf");
    expect(pdf.querySelector("a").getAttribute("aria-label")).toBe("Download Field guide.pdf");
    expect(sheet.querySelector("a").getAttribute("href")).toBe("https://files.example.com/packing-list.xlsx");
    expect(sheet.querySelector("a").getAttribute("rel")).toBe("noopener noreferrer");
    expect(sheet.getAttribute("data-file-type")).toBe("sheet");
  });

  test("empty media blocks render nothing for learners", async () => {
    const el = await mount(doc({ type: "gallery" }, { type: "imageCompare" }, { type: "fileCard" }, { type: "chart" }, p("after")));
    await flush(50);
    expect(el.querySelector(".lh-gallery, .lh-image-compare, .lh-file-card, .lh-chart")).toBeNull();
    expect(el.textContent).toContain("after");
  });
});

// ── Editor ─────────────────────────────────────────────────────────────────

function makeEditor(content, mode = "editor") {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({ element, content, extensions: extensions(mode) });
}
const findPos = (editor, name) => {
  let pos = -1;
  editor.state.doc.descendants((n, at) => {
    if (pos < 0 && n.type.name === name) pos = at;
  });
  return pos;
};
const props = (editor, name) => {
  const pos = findPos(editor, name);
  return { editor, getPos: () => pos, node: editor.state.doc.nodeAt(pos) };
};

describe("editor", () => {
  test("every slash item inserts valid, filled starter content", () => {
    expect(mediaSlashItems.map((i) => [i.id, i.category])).toEqual([
      ["gallery", "media"], ["imageCompare", "media"], ["fileCard", "media"], ["quoteBlock", "media"], ["quote", "media"], ["chart", "data"], ["statHighlights", "data"],
    ]);
    for (const item of mediaSlashItems) {
      expect(item.titleKey).toMatch(/^editor\.slash_menu\.items\.[a-z_]+\.title$/);
      const editor = makeEditor(doc(p("")));
      item.command(editor);
      expect(() => editor.state.doc.check()).not.toThrow();
      const node = editor.state.doc.firstChild;
      const expected = { gallery: "gallery", imageCompare: "imageCompare", fileCard: "fileCard", quoteBlock: "quoteBlock", quote: "blockquote", chart: "chart", statHighlights: "statHighlights" }[item.id];
      expect([item.id, node.type.name]).toEqual([item.id, expected]);
      if (node.type.name === "chart") {
        expect(node.attrs.data.series.length).toBe(2);
        expect(node.attrs.data.labels.length).toBe(4);
        expect(node.attrs.title.length).toBeGreaterThan(0);
      }
      if (node.type.name === "statHighlights") expect(node.attrs.items.length).toBe(3);
      if (node.type.name === "quoteBlock") expect([node.attrs.variant, !!node.attrs.author, node.textContent.length > 0]).toEqual(["testimonial", true, true]);
      if (node.type.name === "gallery") expect([node.attrs.images, typeof node.attrs.blockId]).toEqual([[], "string"]);
      editor.destroy();
    }
  });

  test("live-attr commits merge onto the latest attrs and skip no-op writes", () => {
    const editor = makeEditor(doc({ type: "statHighlights", attrs: { items: [{ id: "a", value: "1", label: "One" }] } }));
    const add = (live) => ({ items: [...live.items, { id: "b", value: "2", label: "Two" }] });
    expect(S.commitAttrs(props(editor, "statHighlights"), add)).toBe(true);
    expect(S.commitAttrs(props(editor, "statHighlights"), { columns: 4 })).toBe(true);
    expect(S.commitAttrs(props(editor, "statHighlights"), { columns: 4 })).toBe(false);
    expect(S.commitAttrs(props(editor, "statHighlights"), () => null)).toBe(false);
    const node = editor.state.doc.firstChild;
    expect(node.attrs.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(node.attrs.columns).toBe(4);
    expect(S.liveAttrs(props(editor, "statHighlights")).columns).toBe(4);
    // Without a live editor (StaticCanva) commits are inert.
    expect(S.commitAttrs({ editor: { view: { dom: null } }, getPos: () => 0, node }, { columns: 2 })).toBe(false);
    editor.destroy();
  });

  test("the chart data grid edits cells and replaces the table from a pasted sheet", async () => {
    let data = C.sampleChartData((_k, f) => f);
    function Harness() {
      const [d, setD] = React.useState(data);
      data = d;
      return React.createElement(ChartDataEditor, { data: d, onChange: setD });
    }
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(React.createElement(Harness)));
    const input = (label) => el.querySelector(`input[aria-label="${label}"]`);
    const type = async (node, value) => {
      await act(async () => {
        node.dispatchEvent(new window.FocusEvent("focus", { bubbles: true }));
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(node, value);
        node.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
      await act(async () => node.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true })));
    };
    await type(input("Q2, Class B"), "1,5");
    expect(data.series[1].values[1]).toBe(1.5);
    await type(input("Label 1"), "Spring");
    expect(data.labels[0]).toBe("Spring");
    await click([...el.querySelectorAll("button")].find((b) => b.textContent === "Add row"));
    expect(data.labels.length).toBe(5);
    await click([...el.querySelectorAll("button")].find((b) => b.textContent === "Add series"));
    expect(data.series.length).toBe(3);
    await click(el.querySelector('button[aria-label="Remove series"]'));
    expect(data.series.map((s) => s.name)).toEqual(["Class B", "Series 3"]);
    await click(el.querySelector('button[aria-label^="Change color of"]'));
    expect(data.series[0].tone).not.toBe("teal");
    // Paste CSV box.
    await click([...el.querySelectorAll("button")].find((b) => b.textContent === "Paste CSV"));
    const box = el.querySelector("textarea");
    expect(box.value.split("\n")[0]).toBe("Labels,Class B,Series 3");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(box, "Day,Visits\nMon,10\nTue,12");
      box.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await click([...el.querySelectorAll("button")].find((b) => b.textContent === "Use this data"));
    expect(data.labels).toEqual(["Mon", "Tue"]);
    expect(data.series).toEqual([{ name: "Visits", values: [10, 12], tone: data.series[0].tone }]);
    // A sheet that can't be read shows a message and changes nothing.
    await click([...el.querySelectorAll("button")].find((b) => b.textContent === "Paste CSV"));
    const box2 = el.querySelector("textarea");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(box2, "nothing here");
      box2.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await click([...el.querySelectorAll("button")].find((b) => b.textContent === "Use this data"));
    expect(el.querySelector('[role="alert"]').textContent).toContain("Couldn’t read that table");
    expect(data.labels).toEqual(["Mon", "Tue"]);
    await act(async () => root.unmount());
    el.remove();
  });
});

describe("editor views", () => {
  // Each view rendered as the editor would, against a live document, so its
  // controls write real transactions.
  async function editorView(content, name) {
    const editor = makeEditor(content);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    const render = () => {
      const pr = props(editor, name);
      return React.createElement(
        EditorOptionsProvider,
        { options: { isEditable: true } },
        React.createElement(ReactNodeViewContentProvider, { content: null }, React.createElement(VIEWS[name], { ...pr, selected: true, extension: { options: { activity: { activity_uuid: "act_1" } } }, updateAttributes() {}, deleteNode() {}, decorations: [] })),
      );
    };
    await act(async () => root.render(render()));
    editor.on("transaction", () => root.render(render()));
    const done = async () => {
      await act(async () => root.unmount());
      el.remove();
      editor.destroy();
    };
    return { editor, el, done, node: () => editor.state.doc.nodeAt(findPos(editor, name)) };
  }
  const button = (el, label) => el.querySelector(`button[aria-label="${label}"]`) ?? [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
  const typeInto = async (node, value) => {
    await act(async () => {
      node.dispatchEvent(new window.FocusEvent("focus", { bubbles: true }));
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(node, value);
      node.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await act(async () => node.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true })));
  };

  test("gallery: empty state asks for images; tiles flag missing alt text, reorder and remove", async () => {
    const empty = await editorView(doc({ type: "gallery" }), "gallery");
    expect(empty.el.textContent).toContain("Add images to your gallery");
    expect(button(empty.el, "Add images")).toBeTruthy();
    await empty.done();
    const v = await editorView(doc(EVERY.content[1]), "gallery");
    expect(v.el.textContent).toContain("Alt text missing: 1");
    expect(v.el.querySelectorAll('input[aria-invalid="true"]').length).toBe(1);
    await typeInto(v.el.querySelectorAll('input[aria-label="Alt text"]')[2], "A white lighthouse");
    expect(v.node().attrs.images[2].alt).toBe("A white lighthouse");
    expect(v.el.textContent).not.toContain("Alt text missing");
    await click(v.el.querySelectorAll('button[aria-label="Move later"]')[0]);
    expect(v.node().attrs.images.map((i) => i.id)).toEqual(["img_2", "img_1", "img_3"]);
    await click(v.el.querySelectorAll('button[aria-label="Remove image"]')[0]);
    expect(v.node().attrs.images.map((i) => i.id)).toEqual(["img_1", "img_3"]);
    await v.done();
  });

  test("image compare: two slots until both images are set", async () => {
    const v = await editorView(doc({ type: "imageCompare", attrs: { before: { url: "https://x.test/a.png", label: "" } } }), "imageCompare");
    expect(v.el.textContent).toContain("Add images");
    expect(v.el.querySelectorAll("img").length).toBe(1);
    expect(v.el.textContent).toContain("After image");
    await click(button(v.el, "Replace"));
    expect(v.node().attrs.before).toEqual({ label: "" });
    await v.done();
  });

  test("chart: edit the data inline and the document follows", async () => {
    const v = await editorView(doc(EVERY.content[3]), "chart");
    expect(v.el.querySelector("svg [data-mark]")).toBeTruthy();
    await click(button(v.el, "Edit data"));
    await typeInto(v.el.querySelector('input[aria-label="Q1, Class A"]'), "99");
    expect(v.node().attrs.data.series[0].values[0]).toBe(99);
    await typeInto(v.el.querySelector('input[aria-label="Title"]'), "Scores");
    expect(v.node().attrs.title).toBe("Scores");
    await v.done();
  });

  test("stats: edit, add and remove items", async () => {
    const v = await editorView(doc(EVERY.content[5]), "statHighlights");
    await typeInto(v.el.querySelectorAll('input[aria-label="Number"]')[0], "95");
    expect(v.node().attrs.items[0].value).toBe("95");
    await click(button(v.el, "Add stat"));
    expect(v.node().attrs.items.length).toBe(4);
    await click(v.el.querySelectorAll('button[aria-label="Remove stat"]')[3]);
    expect(v.node().attrs.items.map((i) => i.id)).toEqual(["stat_1", "stat_2", "stat_3"]);
    await v.done();
  });

  test("file card: upload or link when empty, edit name and description", async () => {
    const empty = await editorView(doc({ type: "fileCard" }), "fileCard");
    expect(empty.el.textContent).toContain("Add a file to download");
    await click(button(empty.el, "Link"));
    const url = empty.el.querySelector('input[type="url"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(url, "https://files.example.com/notes.docx");
      url.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await act(async () => url.closest("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    expect(empty.node().attrs).toMatchObject({ url: "https://files.example.com/notes.docx", name: "notes.docx", fileType: "doc" });
    await empty.done();
    const v = await editorView(doc(EVERY.content[6]), "fileCard");
    await typeInto(v.el.querySelector('input[aria-label="File name"]'), "Guide");
    await typeInto(v.el.querySelector('input[aria-label="Description"]'), "");
    expect(v.node().attrs).toMatchObject({ name: "Guide", description: null });
    await v.done();
  });

  test("quote: author and role are edited in place", async () => {
    const v = await editorView(doc(EVERY.content[8]), "quoteBlock");
    await typeInto(v.el.querySelector('input[aria-label="Author"]'), "Ana Lopez");
    await typeInto(v.el.querySelector('input[aria-label="Role"]'), "  ");
    expect(v.node().attrs).toMatchObject({ author: "Ana Lopez", role: null });
    await v.done();
  });
});

describe("translations", () => {
  const SRC = new URL(MEDIA, import.meta.url);
  const files = [...readdirSync(SRC), ...readdirSync(new URL("views/", SRC)).map((f) => `views/${f}`)].filter((f) => /\.tsx?$/.test(f));
  const source = files.map((f) => readFileSync(new URL(f, SRC), "utf8")).join("\n");
  const used = new Set([...source.matchAll(/'((?:editor\.blocks_v2|activities|editor\.slash_menu\.items)\.[a-z0-9_.]+)'/g)].map((m) => m[1]));
  // Keys built from a template string.
  for (const k of ["gallery", "image_compare", "file_card", "quote_block", "quote", "chart", "stat_highlights"]) for (const f of ["title", "description"]) used.add(`editor.slash_menu.items.${k}.${f}`);
  for (const ty of C.CHART_TYPES) used.add(`activities.chart.types.${ty}`);
  for (const ty of M.FILE_TYPES) used.add(`activities.file_card.types.${ty}`);
  for (const tone of M.STAT_TONES) used.add(`editor.blocks_v2.layout.tone_${tone}`);
  for (const side of ["before", "after"]) used.add(`editor.blocks_v2.image_compare.${side}_image`);
  for (const l of M.GALLERY_LAYOUTS) used.add(`editor.blocks_v2.gallery.layout_${l}`);
  const get = (obj, k) => k.split(".").reduce((o, part) => (o && typeof o === "object" ? o[part] : undefined), obj);
  const localeDir = new URL("../locales/", import.meta.url);
  const locales = readdirSync(localeDir).filter((f) => f.endsWith(".json"));
  const en = JSON.parse(readFileSync(new URL("en.json", localeDir), "utf8"));

  test("every key the media blocks use exists in all 22 locales, placeholders intact", () => {
    expect(locales.length).toBe(22);
    expect(used.size).toBeGreaterThan(150);
    for (const file of locales) {
      const data = JSON.parse(readFileSync(new URL(file, localeDir), "utf8"));
      for (const k of used) {
        const v = get(data, k);
        expect([file, k, typeof v]).toEqual([file, k, "string"]);
        expect(v.trim().length).toBeGreaterThan(0);
        const ph = (s) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
        expect([file, k, ph(v)]).toEqual([file, k, ph(get(en, k))]);
      }
    }
  });

  test("other languages are really translated", () => {
    const fr = JSON.parse(readFileSync(new URL("fr.json", localeDir), "utf8"));
    const ja = JSON.parse(readFileSync(new URL("ja.json", localeDir), "utf8"));
    const same = [...used].filter((k) => get(fr, k) === get(en, k) && get(ja, k) === get(en, k)).sort();
    // Only placeholder-only strings and the file format name may match English.
    expect(same).toEqual(["activities.file_card.types.pdf", "activities.gallery.counter"]);
  });
});
